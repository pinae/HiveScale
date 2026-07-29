"""Round API (WP-06): the core game loop, deal -> guess -> score -> reveal.

Key design decisions:
- **Signed round tokens.** ``next`` returns a token binding (pairing, player,
  deal-time). ``guess`` only accepts it back from the same player, and the
  response time is computed server-side from the token's timestamp — the speed
  floor (plan §1.7) cannot be gamed by a client-supplied number.
- **Scored against the pre-guess snapshot.** You are scored against the crowd,
  never including yourself; the baseline is recomputed only *after* the answer
  is stored (plan §1.4).
- **Flagged rounds still get their reveal** (losing must be entertaining) but
  earn no xp, no streak, no calibration fold, and never enter the baseline.
- **Pioneer rounds** (pairing not yet graduated) pay a flat bonus and may show
  a clearly-labeled provisional AI estimate; model internals stay internal
  (plan §1.5).
"""

import time as _time

from django.core import signing
from django.db import transaction
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiExample, extend_schema
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from bglib.scoring import (
    CalibrationStats,
    SnapshotStats,
    calibration_update,
    crps,
    detect_bimodality,
    guess_to_distribution,
    visible_score,
)
from bglib.scoring import Guess as GuessValue
from core import leveling
from core.models import Guess, Pairing, RoundScore
from core.scheduler import NoPairingAvailable, deal, serialize_deal
from core.services import SPEED_FLOOR_MS, eligible_guesses, recompute_snapshot
from core.sessions import resolve_player
from core.streaks import register_play
from core.tasks import schedule_cold_start

#: Flat reward for answering an ungraduated pairing. Deliberately a touch above
#: the expected value of a normal round so pioneering never feels like unpaid
#: labor (plan §2.5).
PIONEER_BONUS = 550

#: Visible total at or above which a round extends the in-session hot streak.
GOOD_ROUND_THRESHOLD = 500.0

#: A dealt round stays answerable for ten minutes.
ROUND_TOKEN_MAX_AGE = 60 * 10
_ROUND_SALT = "hivescale.round"


def issue_round_token(pairing: Pairing, player, issued_at: float | None = None) -> str:
    """Sign a round ticket binding the pairing, the player, and the deal time."""
    return signing.dumps(
        {
            "p": pairing.pk,
            "u": player.pk,
            "ts": issued_at if issued_at is not None else _time.time(),
        },
        salt=_ROUND_SALT,
    )


def _unauthorized() -> Response:
    return Response({"detail": "No active session."}, status=status.HTTP_401_UNAUTHORIZED)


def _bad_request(detail: str) -> Response:
    return Response({"detail": detail}, status=status.HTTP_400_BAD_REQUEST)


@extend_schema(
    responses={200: OpenApiTypes.OBJECT},
    examples=[
        OpenApiExample(
            "deal",
            value={
                "round_token": "eyJwIjoxLi4ufQ:signed",
                "pairing_id": 1,
                "thing": {"text": "Robotic lawnmower"},
                "scale": {"left": "sophisticated", "right": "overly complicated"},
            },
            response_only=True,
        )
    ],
)
@api_view(["GET"])
def next_round(request) -> Response:
    """Deal the next blind round (plan §1.5: no distribution data leaves here)."""
    player = resolve_player(request)
    if player is None:
        return _unauthorized()
    try:
        pairing = deal(player)
    except NoPairingAvailable:
        return Response(
            {"detail": "No pairings available."}, status=status.HTTP_404_NOT_FOUND
        )
    # A brand-new pairing has no baseline yet — kick off the AI cold start
    # (best-effort; the deal never fails if the worker/broker is unavailable).
    schedule_cold_start(pairing)
    payload = serialize_deal(pairing)
    payload["round_token"] = issue_round_token(pairing, player)
    return Response(payload)


@extend_schema(
    request=OpenApiTypes.OBJECT,
    responses={200: OpenApiTypes.OBJECT},
    examples=[
        OpenApiExample(
            "reveal_human",
            value={
                "source": "human",
                "counted": True,
                "score": {
                    "total": 853.7,
                    "distance_points": 600.0,
                    "calibration_points": 253.7,
                    "covered_fraction": 0.71,
                },
                "crowd": {
                    "histogram": [0.0] * 8 + [0.2, 0.3, 0.3, 0.2] + [0.0] * 8,
                    "median": 52.5,
                    "q25": 41.1,
                    "q75": 63.8,
                    "n": 23,
                },
                "percentile": 83.0,
                "bimodal": False,
                "streak": {"hot": 3},
                "player": {"xp": 4212, "level": 2},
            },
            response_only=True,
        ),
        OpenApiExample(
            "reveal_pioneer",
            value={
                "source": "pioneer",
                "counted": True,
                "pioneer_bonus": PIONEER_BONUS,
                "ai_estimate": {
                    "provisional": True,
                    "median": 62.0,
                    "q25": 50.0,
                    "q75": 74.0,
                    "histogram": [0.05] * 20,
                },
                "streak": {"hot": 3},
                "player": {"xp": 4762, "level": 2},
            },
            response_only=True,
        ),
    ],
)
@api_view(["POST"])
def submit_guess(request) -> Response:
    """Submit a guess for a dealt round and receive the reveal payload."""
    player = resolve_player(request)
    if player is None:
        return _unauthorized()

    try:
        ticket = signing.loads(
            str(request.data.get("round_token", "")),
            salt=_ROUND_SALT,
            max_age=ROUND_TOKEN_MAX_AGE,
        )
    except signing.BadSignature:
        return _bad_request("Invalid or expired round token.")
    if ticket["u"] != player.pk:
        return _bad_request("This round was dealt to a different player.")

    try:
        value = GuessValue(
            center=float(request.data.get("center")),
            width_left=float(request.data.get("width_left")),
            width_right=float(request.data.get("width_right")),
        )
        guess_to_distribution(value)  # validates geometry before any DB write
    except (TypeError, ValueError):
        return _bad_request("Invalid guess geometry.")

    pairing = (
        Pairing.objects.select_related("thing", "scale").filter(pk=ticket["p"]).first()
    )
    if pairing is None:
        return _bad_request("This pairing no longer exists.")

    # Response time is authoritative from the signed deal timestamp; the speed
    # floor can't be gamed by a client-supplied number.
    response_ms = max(0, int((_time.time() - ticket["ts"]) * 1000))
    body, _guess = score_and_record(player, pairing, value, response_ms)
    return Response(body)


def score_and_record(player, pairing: Pairing, value: GuessValue, response_ms: int):
    """Score a validated guess against the pre-answer baseline, persist it, and
    return ``(reveal_body, guess)``.

    Shared by the round loop and the Daily Wave so both score identically (plan
    §1.4): the same speed floor, the same pre-guess snapshot, the same human /
    pioneer split, and the same streak/xp folding on counted answers.
    """
    flags = ["too_fast"] if response_ms < SPEED_FLOOR_MS else []
    counted = not flags

    # Score against the crowd as it stood *before* this answer.
    snapshot = (
        pairing.snapshots.order_by("-computed_at", "-id").first()
        if pairing.graduated
        else None
    )

    with transaction.atomic():
        percentile = _percentile(pairing, value, snapshot)

        guess = Guess.objects.create(
            pairing=pairing,
            player=player,
            center=value.center,
            width_left=value.width_left,
            width_right=value.width_right,
            response_ms=response_ms,
            quality_flags=flags,
        )

        if snapshot is not None:
            body = _human_reveal(player, guess, value, snapshot, percentile, counted)
        else:
            body = _pioneer_reveal(player, pairing, guess, counted)

        if counted:
            _apply_progression(player, body)
            recompute_snapshot(pairing)
            register_play(player, timezone.localdate())

    body["streak"] = {"hot": player.hot_streak, "daily": player.daily_streak}
    body["player"] = {
        "xp": player.xp,
        "level": player.level,
        "multiplier": player.xp_multiplier,
    }
    body["progress"] = leveling.level_progress(player.xp)
    return body, guess


def _apply_progression(player, body: dict) -> None:
    """Bank a counted round's XP (times the multiplier), re-level, and roll the
    multiplier for the next round (plan progression)."""
    visible = body["score"]["total"] if body["source"] == "human" else body["pioneer_bonus"]
    covered = body["score"]["covered_fraction"] if body["source"] == "human" else None

    effective = leveling.effective_multiplier(player.level, player.xp_multiplier)
    player.xp += int(round(visible * effective))
    player.level = leveling.level_for_xp(player.xp)
    player.xp_multiplier = leveling.next_multiplier(
        player.xp_multiplier,
        level=player.level,
        source=body["source"],
        bimodal=bool(body.get("bimodal", False)),
        covered_fraction=covered,
    )
    player.save(update_fields=["xp", "level", "xp_multiplier"])


def _percentile(pairing, value, snapshot) -> float | None:
    """Share of the eligible crowd this guess is closer to the median than."""
    if snapshot is None:
        return None
    distances = [
        abs(center - snapshot.median)
        for center in eligible_guesses(pairing).values_list("center", flat=True)
    ]
    if not distances:
        return 100.0
    mine = abs(value.center - snapshot.median)
    return 100.0 * sum(d > mine for d in distances) / len(distances)


def _human_reveal(player, guess, value, snapshot, percentile, counted) -> dict:
    stats = SnapshotStats(median=snapshot.median, q25=snapshot.q25, q75=snapshot.q75)
    breakdown = visible_score(value, stats)
    histogram = tuple(snapshot.histogram)
    hidden_crps = crps(guess_to_distribution(value), histogram)

    RoundScore.objects.create(
        guess=guess,
        visible_points=breakdown.total,
        crps=hidden_crps,
        components={
            "snapshot_id": snapshot.pk,
            "distance_points": breakdown.distance_points,
            "calibration_points": breakdown.calibration_points,
            "covered_fraction": breakdown.covered_fraction,
            "percentile": percentile,
            "pioneer": False,
            "counted": counted,
        },
    )

    if counted:
        # XP + level + multiplier are applied centrally in _apply_progression;
        # here we only fold the streak and the running calibration curve.
        player.hot_streak = (
            player.hot_streak + 1 if breakdown.total >= GOOD_ROUND_THRESHOLD else 0
        )
        current = CalibrationStats(
            n=int(player.calibration_stats.get("n", 0)),
            hits=int(player.calibration_stats.get("hits", 0)),
            total_width=float(player.calibration_stats.get("total_width", 0.0)),
        )
        folded = calibration_update(current, value, stats)
        player.calibration_stats = {
            "n": folded.n,
            "hits": folded.hits,
            "total_width": folded.total_width,
        }
        player.save(update_fields=["hot_streak", "calibration_stats"])

    return {
        "source": "human",
        "counted": counted,
        "score": {
            "total": breakdown.total,
            "distance_points": breakdown.distance_points,
            "calibration_points": breakdown.calibration_points,
            "covered_fraction": breakdown.covered_fraction,
        },
        "crowd": {
            "histogram": list(histogram),
            "median": snapshot.median,
            "q25": snapshot.q25,
            "q75": snapshot.q75,
            "n": snapshot.n,
        },
        "percentile": percentile,
        "bimodal": detect_bimodality(histogram).is_bimodal,
    }


def _pioneer_reveal(player, pairing, guess, counted) -> dict:
    ai = pairing.ai_distributions.order_by("-created_at").first()
    estimate = None
    if ai is not None:
        estimate = {
            "provisional": True,
            "median": ai.median,
            "q25": ai.q25,
            "q75": ai.q75,
            "histogram": list(ai.histogram),
        }

    RoundScore.objects.create(
        guess=guess,
        visible_points=PIONEER_BONUS,
        crps=None,
        components={"pioneer": True, "counted": counted},
    )
    # XP for counted pioneer rounds is banked centrally in _apply_progression.

    return {
        "source": "pioneer",
        "counted": counted,
        "pioneer_bonus": PIONEER_BONUS,
        "ai_estimate": estimate,
    }

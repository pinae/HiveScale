"""Daily Wave play API (WP-11, plan §2.2 / §3.3).

``GET /api/daily-wave/`` returns today's shared set with the player's progress
and the next blind slot to answer; ``POST /api/daily-wave/guess/`` scores one
slot (reusing the round-loop scorer) and hands back the reveal plus updated
progress. Completing all slots yields the Wordle-style share string.

The wave is the same ordered pairings for everyone on a date (generated lazily
if the daily command hasn't run), each slot is answered once, and — like every
deal — no distribution data ships until the guess is in (the blind guarantee).
"""

import datetime
import time as _time

from django.core import signing
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import api_view
from rest_framework.response import Response

from bglib.scoring import Guess as GuessValue
from bglib.scoring import guess_to_distribution
from core.daily_wave import generate_daily_wave, grade_emoji, share_string
from core.models import DailyWave, DailyWaveEntry, Pairing
from core.round_api import (
    ROUND_TOKEN_MAX_AGE,
    _bad_request,
    _unauthorized,
    score_and_record,
)
from core.scheduler import serialize_deal
from core.sessions import resolve_player

_WAVE_SALT = "hivescale.daily-wave"


def _issue_wave_token(day: datetime.date, player, pairing_id: int, index: int) -> str:
    """Sign a slot ticket binding the day, player, pairing, and its position."""
    return signing.dumps(
        {"d": day.isoformat(), "u": player.pk, "p": pairing_id, "i": index, "ts": _time.time()},
        salt=_WAVE_SALT,
    )


def _today_wave(day: datetime.date) -> DailyWave | None:
    """Today's wave, generating it lazily if the daily command hasn't run."""
    wave = DailyWave.objects.filter(date=day).first()
    if wave is not None:
        return wave
    try:
        return generate_daily_wave(day)
    except ValueError:
        return None


def _next_slot(wave: DailyWave, player, day: datetime.date, answered: set[int]) -> dict | None:
    """The first unanswered, still-playable slot as a blind deal + wave token."""
    for index, pairing_id in enumerate(wave.pairing_ids):
        if index in answered:
            continue
        pairing = Pairing.objects.select_related("thing", "scale").filter(pk=pairing_id).first()
        if pairing is None:
            continue  # a since-removed pairing: skip it rather than stall the wave
        deal = serialize_deal(pairing)
        return {
            "index": index,
            "pairing_id": pairing_id,
            "thing": deal["thing"],
            "scale": deal["scale"],
            "wave_token": _issue_wave_token(day, player, pairing_id, index),
        }
    return None


def _progress(wave: DailyWave, player, day: datetime.date) -> dict:
    """The player's Daily Wave state: emoji results so far, next slot, share string."""
    entries = list(DailyWaveEntry.objects.filter(wave=wave, player=player).order_by("index"))
    answered = {entry.index for entry in entries}
    scores = [entry.visible_points for entry in entries]
    total = len(wave.pairing_ids)
    nxt = _next_slot(wave, player, day, answered)
    # Completed once every playable slot has an answer (a since-removed pairing
    # can't be answered, so "no next slot left" is the real completion signal).
    completed = nxt is None and len(answered) > 0
    return {
        "date": day.isoformat(),
        "total": total,
        "answered": len(answered),
        "completed": completed,
        "results": [grade_emoji(s) for s in scores],
        "score": round(sum(scores)),
        "next": nxt,
        "daily_streak": player.daily_streak,
        "share_string": share_string(day, scores, player.daily_streak) if completed else None,
    }


@extend_schema(responses={200: OpenApiTypes.OBJECT})
@api_view(["GET"])
def daily_wave(request) -> Response:
    """Today's Daily Wave and the player's progress through it."""
    player = resolve_player(request)
    if player is None:
        return _unauthorized()
    day = timezone.localdate()
    wave = _today_wave(day)
    if wave is None:
        return Response({"detail": "No Daily Wave available."}, status=404)
    return Response(_progress(wave, player, day))


@extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
@api_view(["POST"])
def daily_wave_guess(request) -> Response:
    """Answer one slot of today's Daily Wave; returns the reveal + wave progress."""
    player = resolve_player(request)
    if player is None:
        return _unauthorized()

    try:
        ticket = signing.loads(
            str(request.data.get("wave_token", "")), salt=_WAVE_SALT, max_age=ROUND_TOKEN_MAX_AGE
        )
    except signing.BadSignature:
        return _bad_request("Invalid or expired wave token.")
    if ticket["u"] != player.pk:
        return _bad_request("This wave slot was dealt to a different player.")

    day = timezone.localdate()
    if ticket["d"] != day.isoformat():
        return _bad_request("This Daily Wave has expired.")

    wave = DailyWave.objects.filter(date=day).first()
    index = ticket["i"]
    if wave is None or index >= len(wave.pairing_ids) or wave.pairing_ids[index] != ticket["p"]:
        return _bad_request("This wave slot is no longer valid.")
    if DailyWaveEntry.objects.filter(wave=wave, player=player, index=index).exists():
        return _bad_request("You've already answered this slot.")

    try:
        value = GuessValue(
            center=float(request.data.get("center")),
            width_left=float(request.data.get("width_left")),
            width_right=float(request.data.get("width_right")),
        )
        guess_to_distribution(value)
    except (TypeError, ValueError):
        return _bad_request("Invalid guess geometry.")

    pairing = Pairing.objects.select_related("thing", "scale").filter(pk=ticket["p"]).first()
    if pairing is None:
        return _bad_request("This pairing no longer exists.")

    response_ms = max(0, int((_time.time() - ticket["ts"]) * 1000))
    body, guess = score_and_record(player, pairing, value, response_ms)
    visible = body["score"]["total"] if body["source"] == "human" else body["pioneer_bonus"]
    DailyWaveEntry.objects.create(
        wave=wave, player=player, index=index, guess=guess, visible_points=visible
    )

    body["wave"] = _progress(wave, player, day)
    return Response(body)

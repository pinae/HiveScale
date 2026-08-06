"""PvP matches: a head-to-head wave against a friend (plan §2.x).

A match is the Daily Wave idea pointed at one opponent: both players answer the
*same* ordered pairings and are compared round by round.

Design rules:

- **Rating-eligible pairings only.** Every slot is a graduated pairing, so both
  players are scored against a real crowd — a pioneer round has nothing to
  compare. Bimodal ("society at war") pairings are deliberately kept: two friends
  landing on opposite camps is the best part of the mode.
- **Synchronised start.** A pairing is revealed only once *both* players are
  ready (:class:`~core.models.PvpRound` is the barrier). Response time is then
  measured server-side from that one release instant, so "who was faster" is a
  fair race rather than an artefact of who opened the tab first.
- **Speed bonus.** Whoever had the shorter think-time on a round earns ×2 on
  their *next* round. It is single-use and never accumulates (unlike the
  calibration XP multiplier) — a fresh chance every round.
- **Scoring reuses the round loop.** ``round_api.score_and_record`` does the
  scoring, so a PvP answer counts for the dataset, XP, and streaks exactly like
  any other round; the match only layers the duel on top.
"""

from __future__ import annotations

import random
import secrets
import time

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from core.models import ContentStatus, Pairing, PvpEntry, PvpMatch, PvpRound
from core.scheduler import serialize_deal

#: Rounds per match — the Daily Wave length, so a duel feels like a shared wave.
MATCH_SIZE = 10

#: Points multiplier for winning a round's speed race (applies to the next round).
SPEED_BONUS = 2

#: How long a ready-poll waits for the other player before returning "still
#: waiting" so the client can poll again (kept under typical proxy read timeouts).
READY_POLL_SECONDS = 20.0
_READY_TICK_SECONDS = 0.4

DEFAULT_MULTIPLAYER_LEVEL = 4


class PvpError(Exception):
    """A rejected match action; ``args[0]`` is player-facing."""


def multiplayer_level() -> int:
    """Player level that unlocks PvP matches."""
    return int(getattr(settings, "MULTIPLAYER_LEVEL", DEFAULT_MULTIPLAYER_LEVEL))


# ---------------------------------------------------------------------------
# Creating and joining
# ---------------------------------------------------------------------------


def rating_eligible_pairing_ids(
    size: int = MATCH_SIZE, rng: random.Random | None = None
) -> list[int]:
    """``size`` random graduated, active pairing ids — never a pioneer round."""
    rng = rng or random.Random()
    ids = list(
        Pairing.objects.filter(
            status=ContentStatus.ACTIVE,
            thing__status=ContentStatus.ACTIVE,
            scale__status=ContentStatus.ACTIVE,
            graduated_at__isnull=False,
        ).values_list("id", flat=True)
    )
    if len(ids) < size:
        raise PvpError(
            "Not enough rated pairings for a battle yet — play some more rounds first."
        )
    return rng.sample(sorted(ids), size)


def create_match(challenger, invited_email: str = "", rng: random.Random | None = None) -> PvpMatch:
    """Open a match waiting for an opponent."""
    return PvpMatch.objects.create(
        challenger=challenger,
        join_code=secrets.token_urlsafe(12),
        pairing_ids=rating_eligible_pairing_ids(rng=rng),
        invited_email=invited_email,
    )


def join_match(player, join_code: str) -> PvpMatch:
    """Claim the open opponent slot (idempotent for players already in the match)."""
    with transaction.atomic():
        match = PvpMatch.objects.select_for_update().filter(join_code=join_code).first()
        if match is None:
            raise PvpError("That battle link is not valid.")
        if match.has_player(player):
            return match
        if match.is_full:
            raise PvpError("That battle already has two players.")
        match.opponent = player
        match.save(update_fields=["opponent"])
        return match


# ---------------------------------------------------------------------------
# The start barrier
# ---------------------------------------------------------------------------


def _started_cache_key(match_id: int, index: int) -> str:
    return f"pvp:{match_id}:{index}:started"


def mark_ready(match: PvpMatch, player, index: int) -> PvpRound:
    """Mark ``player`` ready for slot ``index``; release the barrier if both are.

    Returns the round; ``started_at`` is set once both players have arrived.
    """
    if not 0 <= index < len(match.pairing_ids):
        raise PvpError("That round is not part of this battle.")
    if not match.has_player(player):
        raise PvpError("You are not part of this battle.")

    with transaction.atomic():
        row, _ = PvpRound.objects.select_for_update().get_or_create(match=match, index=index)
        now = timezone.now()
        field = "challenger_ready_at" if player.pk == match.challenger_id else "opponent_ready_at"
        updates = []
        if getattr(row, field) is None:
            setattr(row, field, now)
            updates.append(field)
        if row.started_at is None and row.both_ready:
            row.started_at = now
            updates.append("started_at")
        if updates:
            row.save(update_fields=updates)

    if row.started_at is not None:
        # Wake the other player's poll loop without a database round-trip.
        cache.set(_started_cache_key(match.pk, index), row.started_at.timestamp(), 3600)
    return row


def wait_for_start(
    match: PvpMatch, index: int, timeout: float = READY_POLL_SECONDS
) -> PvpRound | None:
    """Long-poll until the barrier for ``index`` releases; ``None`` on timeout.

    The cache flag is only an accelerator — the database row is authoritative, so
    a cold cache (or no Redis at all) merely means waiting a tick longer.
    """
    deadline = time.monotonic() + timeout
    while True:
        if cache.get(_started_cache_key(match.pk, index)) is not None:
            row = PvpRound.objects.filter(match=match, index=index).first()
            if row is not None and row.started_at is not None:
                return row
        row = PvpRound.objects.filter(match=match, index=index).first()
        if row is not None and row.started_at is not None:
            return row
        if time.monotonic() >= deadline:
            return None
        time.sleep(_READY_TICK_SECONDS)


# ---------------------------------------------------------------------------
# Answering
# ---------------------------------------------------------------------------


def speed_bonus_for(match: PvpMatch, player, index: int) -> bool:
    """Did ``player`` win the speed race on the *previous* round?

    The bonus is earned by the shorter think-time and spent on the next round
    only. If the opponent hasn't answered the previous round yet there is no race
    to win, so no bonus — it is decided at submit time, from the times on record.
    """
    if index <= 0:
        return False
    other_id = match.other_player_id(player)
    if other_id is None:
        return False
    mine = PvpEntry.objects.filter(match=match, player=player, index=index - 1).first()
    theirs = PvpEntry.objects.filter(match=match, player_id=other_id, index=index - 1).first()
    if mine is None or theirs is None:
        return False
    return mine.response_ms < theirs.response_ms


def record_match_guess(match: PvpMatch, player, index: int, value) -> tuple[dict, PvpEntry]:
    """Score one slot for ``player`` and record the match entry.

    Response time comes from the barrier's ``started_at`` — never from the client
    — so both players are timed from the same instant.
    """
    from core.round_api import score_and_record  # local: round_api imports nothing from here

    if not match.has_player(player):
        raise PvpError("You are not part of this battle.")
    if not 0 <= index < len(match.pairing_ids):
        raise PvpError("That round is not part of this battle.")
    if PvpEntry.objects.filter(match=match, player=player, index=index).exists():
        raise PvpError("You've already answered this round.")

    row = PvpRound.objects.filter(match=match, index=index).first()
    if row is None or row.started_at is None:
        raise PvpError("That round hasn't started yet.")

    pairing = (
        Pairing.objects.select_related("thing", "scale")
        .filter(pk=match.pairing_ids[index])
        .first()
    )
    if pairing is None:
        raise PvpError("That pairing no longer exists.")

    response_ms = max(0, int((timezone.now() - row.started_at).total_seconds() * 1000))
    body, guess = score_and_record(player, pairing, value, response_ms)

    bonus = speed_bonus_for(match, player, index)
    base = body["score"]["total"] if body["source"] == "human" else body.get("pioneer_bonus", 0)
    means = body["score"]["means_match"] if body["source"] == "human" else 0.0
    belief = body["score"]["belief_match"] if body["source"] == "human" else 0.0

    entry = PvpEntry.objects.create(
        match=match,
        player=player,
        index=index,
        guess=guess,
        visible_points=base * (SPEED_BONUS if bonus else 1),
        means_match=means,
        belief_match=belief,
        response_ms=response_ms,
        speed_bonus=bonus,
    )
    _maybe_complete(match)
    body["speed_bonus"] = bonus
    return body, entry


def _maybe_complete(match: PvpMatch) -> None:
    """Stamp ``completed_at`` once both players have answered every slot."""
    if match.completed_at is not None or not match.is_full:
        return
    total = len(match.pairing_ids)
    counts = {
        pid: PvpEntry.objects.filter(match=match, player_id=pid).count()
        for pid in (match.challenger_id, match.opponent_id)
    }
    if all(c >= total for c in counts.values()):
        match.completed_at = timezone.now()
        match.save(update_fields=["completed_at"])


# ---------------------------------------------------------------------------
# State for the client
# ---------------------------------------------------------------------------


def _serialize_entries(entries) -> list[dict]:
    return [
        {
            "index": e.index,
            "points": e.visible_points,
            "means_match": e.means_match,
            "belief_match": e.belief_match,
            "response_ms": e.response_ms,
            "speed_bonus": e.speed_bonus,
        }
        for e in entries
    ]


def _chain_end(entries: list[dict]) -> dict:
    """Where a player's arrow chain ends: the summed (means, belief) vector."""
    return {
        "x": sum(e["means_match"] for e in entries),
        "y": sum(e["belief_match"] for e in entries),
    }


def match_state(match: PvpMatch, player) -> dict:
    """Everything the client needs: standings, the next slot, and the result."""
    other_id = match.other_player_id(player)
    mine = list(PvpEntry.objects.filter(match=match, player=player).order_by("index"))
    theirs = (
        list(PvpEntry.objects.filter(match=match, player_id=other_id).order_by("index"))
        if other_id
        else []
    )
    my_rows, their_rows = _serialize_entries(mine), _serialize_entries(theirs)
    my_score = sum(e["points"] for e in my_rows)
    their_score = sum(e["points"] for e in their_rows)
    total = len(match.pairing_ids)

    answered = {e.index for e in mine}
    next_index = next((i for i in range(total) if i not in answered), None)
    nxt = None
    if next_index is not None and match.is_full:
        row = PvpRound.objects.filter(match=match, index=next_index).first()
        started = row is not None and row.started_at is not None
        nxt = {
            "index": next_index,
            "started": started,
            "opponent_ready": _opponent_ready(match, player, row),
            # Blind until the barrier releases: no pairing text before both are in.
            **(_deal_for(match, next_index) if started else {}),
        }

    completed = match.completed_at is not None
    result = None
    if completed:
        my_end, their_end = _chain_end(my_rows), _chain_end(their_rows)
        my_reach, their_reach = my_end["x"] + my_end["y"], their_end["x"] + their_end["y"]
        result = {
            "winner": (
                "you" if my_reach > their_reach else "opponent" if their_reach > my_reach else "tie"
            ),
            # How far ahead the winner's chain reached toward the top-right corner.
            "margin": abs(my_reach - their_reach),
            "score_margin": abs(my_score - their_score),
            "you_end": my_end,
            "opponent_end": their_end,
        }

    return {
        "join_code": match.join_code,
        "total": total,
        "opponent_joined": match.is_full,
        "you": {"answered": len(my_rows), "score": my_score, "entries": my_rows},
        "opponent": {"answered": len(their_rows), "score": their_score, "entries": their_rows},
        # Whether the round you're about to play is already doubled.
        "speed_bonus_next": (
            speed_bonus_for(match, player, next_index) if next_index is not None else False
        ),
        "next": nxt,
        "completed": completed,
        "result": result,
    }


def _opponent_ready(match: PvpMatch, player, row: PvpRound | None) -> bool:
    if row is None:
        return False
    field = "opponent_ready_at" if player.pk == match.challenger_id else "challenger_ready_at"
    return getattr(row, field) is not None


def _deal_for(match: PvpMatch, index: int) -> dict:
    pairing = (
        Pairing.objects.select_related("thing", "scale")
        .filter(pk=match.pairing_ids[index])
        .first()
    )
    if pairing is None:
        return {}
    deal = serialize_deal(pairing)
    return {"pairing_id": deal["pairing_id"], "thing": deal["thing"], "scale": deal["scale"]}

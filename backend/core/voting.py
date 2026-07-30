"""Pairing curation by vote (plan §2.x, unlocked at level 5).

Players judge thing+scale combinations as fun / interesting / boring / weird:

* **Candidate combos** (a thing and scale not yet paired) become real, playable
  pairings the moment someone votes fun or interesting.
* **Existing pairings** accumulate votes; once enough are in and ≥80% are
  negative (boring/weird), the pairing is retired and flagged so it is never
  suggested or played again.

Admins can also set ``Pairing.voting_disabled`` to keep a pairing out of the vote.
"""

import random

from django.conf import settings
from django.db import transaction

from core.models import ContentStatus, Pairing, PairingVote, Scale, Thing, VoteChoice

#: Level that unlocks voting (tunable; the e2e stack lowers it).
DEFAULT_VOTE_LEVEL = 5
#: Votes an existing pairing needs before the negative ratio can retire it.
MIN_VOTES_TO_JUDGE = 5
#: Negative share (boring/weird) at or above which an existing pairing is retired.
RETIRE_NEGATIVE_RATIO = 0.80

#: Vote values (plain strings) grouped by sentiment.
POSITIVE = {VoteChoice.FUN.value, VoteChoice.INTERESTING.value}
NEGATIVE = {VoteChoice.BORING.value, VoteChoice.WEIRD.value}


def vote_level() -> int:
    return getattr(settings, "CONTENT_VOTE_LEVEL", DEFAULT_VOTE_LEVEL)


def unlocks(player) -> dict:
    """Which level-gated contribution features this player has unlocked."""
    # Lazy imports keep this module free of a contribution → voting cycle.
    from core.challenges import challenge_level
    from core.daily_wave import daily_wave_level
    from core.scale_requests import scale_request_level

    return {
        "daily_wave": player.level >= daily_wave_level(),
        "vote": player.level >= vote_level(),
        "challenge": player.level >= challenge_level(),
        "scale": player.level >= scale_request_level(),
    }


def _active_things() -> list[int]:
    return list(Thing.objects.filter(status=ContentStatus.ACTIVE).values_list("id", flat=True))


def _active_scales() -> list[int]:
    return list(Scale.objects.filter(status=ContentStatus.ACTIVE).values_list("id", flat=True))


def random_candidate(rng: random.Random | None = None) -> tuple[Thing, Scale] | None:
    """A random active thing+scale that has *no* pairing yet (a fresh candidate).

    Any pairing row — active, retired, or rejected — counts as "already paired",
    so a combo retired by vote is never suggested again.
    """
    rng = rng or random.Random()
    thing_ids, scale_ids = _active_things(), _active_scales()
    if not thing_ids or not scale_ids:
        return None
    # Sample a handful of combos and return the first that isn't paired yet,
    # rather than materialising the full cross product.
    for _ in range(40):
        thing_id = rng.choice(thing_ids)
        scale_id = rng.choice(scale_ids)
        if not Pairing.objects.filter(thing_id=thing_id, scale_id=scale_id).exists():
            return Thing.objects.get(pk=thing_id), Scale.objects.get(pk=scale_id)
    return None


def random_existing(rng: random.Random | None = None) -> Pairing | None:
    """A random active, vote-enabled pairing to pass judgement on."""
    rng = rng or random.Random()
    ids = list(
        Pairing.objects.filter(status=ContentStatus.ACTIVE, voting_disabled=False).values_list(
            "id", flat=True
        )
    )
    return Pairing.objects.select_related("thing", "scale").get(pk=rng.choice(ids)) if ids else None


@transaction.atomic
def record_vote(player, thing: Thing, scale: Scale, choice: str) -> dict:
    """Record one vote and apply its consequence. Returns a small status dict."""
    PairingVote.objects.update_or_create(
        player=player, thing=thing, scale=scale, defaults={"choice": choice}
    )
    pairing = Pairing.objects.filter(thing=thing, scale=scale).first()

    if pairing is None:
        # A candidate combo: a positive vote promotes it to a real pairing.
        if choice in POSITIVE:
            pairing = Pairing.objects.create(
                thing=thing, scale=scale, status=ContentStatus.ACTIVE
            )
            return {"outcome": "added", "pairing_id": pairing.pk}
        return {"outcome": "noted"}

    return _judge_existing(pairing)


def _judge_existing(pairing: Pairing) -> dict:
    votes = list(
        PairingVote.objects.filter(thing=pairing.thing, scale=pairing.scale).values_list(
            "choice", flat=True
        )
    )
    total = len(votes)
    negative = sum(1 for c in votes if c in NEGATIVE)
    if total >= MIN_VOTES_TO_JUDGE and negative / total >= RETIRE_NEGATIVE_RATIO:
        pairing.status = ContentStatus.REJECTED
        pairing.voting_disabled = True
        pairing.save(update_fields=["status", "voting_disabled"])
        return {"outcome": "retired", "pairing_id": pairing.pk}
    return {"outcome": "recorded", "pairing_id": pairing.pk}

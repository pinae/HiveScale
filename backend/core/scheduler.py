"""Pairing scheduler (WP-05): which pairing does a player see next?

Balances three needs (plan §1.6):
- **well_sampled** (60%) — graduated pairings: reliable baselines, most fun to
  be scored against;
- **under_sampled** (30%) — pairings with some answers but not yet graduated:
  where new data is most valuable;
- **fresh** (10%) — pairings with zero answers: the trickle of brand-new
  content that triggers the AI cold-start (WP-07).

Design rules:
- The RNG is always injected (``deal(player, rng=...)``) so behavior is fully
  deterministic under test — no hidden randomness.
- Candidate ids are sorted before choosing, so the same RNG state yields the
  same deal regardless of database row order.
- If the rolled category has no candidates, the scheduler falls back through
  the remaining categories by weight order rather than failing.
- No repeats within the last ``SESSION_WINDOW`` *answered* pairings; if that
  excludes everything (tiny databases), the window is relaxed rather than
  erroring — a repeat beats a dead end.
- ``serialize_deal`` is the *only* shape a deal leaves the backend in, and it
  is blind by construction: no distribution data, and no field that would let
  a client distinguish a fresh pairing from a graduated one (plan §1.7).
"""

import random
from typing import Protocol

from core.models import ContentStatus, Pairing, Player

#: How many of the player's most recent answered pairings are off-limits.
SESSION_WINDOW = 25

#: Category weights in fall-back order (most to least preferred substitute).
CATEGORY_WEIGHTS: tuple[tuple[str, float], ...] = (
    ("well_sampled", 0.6),
    ("under_sampled", 0.3),
    ("fresh", 0.1),
)


class NoPairingAvailable(Exception):
    """There is no active pairing to deal at all."""


class Rng(Protocol):  # anything random.Random-shaped, including test stubs
    def random(self) -> float: ...
    def choice(self, seq): ...


def recent_pairing_ids(player: Player, window: int = SESSION_WINDOW) -> list[int]:
    """Ids of the player's most recently answered pairings, newest first."""
    return list(
        player.guesses.order_by("-created_at", "-id").values_list("pairing_id", flat=True)[:window]
    )


def deal(
    player: Player,
    rng: Rng | None = None,
    exclude_pairing_ids: tuple[int, ...] | list[int] = (),
) -> Pairing:
    """Deal the next pairing for ``player``. Read-only; raises
    :class:`NoPairingAvailable` only when no active pairing exists at all."""
    rng = rng if rng is not None else random
    excluded = set(recent_pairing_ids(player)) | set(exclude_pairing_ids)

    chosen = _pick(rng, excluded)
    if chosen is None and excluded:
        # Grace fallback: everything active is inside the window — relax it.
        chosen = _pick(rng, set(exclude_pairing_ids))
    if chosen is None:
        raise NoPairingAvailable("no active pairing to deal")
    return chosen


def serialize_deal(pairing: Pairing) -> dict:
    """The blind round payload (plan §1.5/§1.7): identity and labels only."""
    return {
        "pairing_id": pairing.pk,
        "thing": {"text": pairing.thing.text},
        "scale": {"left": pairing.scale.left_label, "right": pairing.scale.right_label},
    }


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _active_pairings(excluded: set[int]):
    return Pairing.objects.filter(
        status=ContentStatus.ACTIVE,
        thing__status=ContentStatus.ACTIVE,
        scale__status=ContentStatus.ACTIVE,
    ).exclude(id__in=excluded)


def _category_queryset(base, category: str):
    if category == "well_sampled":
        return base.filter(graduated_at__isnull=False)
    if category == "under_sampled":
        return base.filter(graduated_at__isnull=True, n_answers__gt=0)
    return base.filter(graduated_at__isnull=True, n_answers=0)  # fresh


def _roll_category(rng: Rng) -> str:
    roll = rng.random()
    cumulative = 0.0
    for name, weight in CATEGORY_WEIGHTS:
        cumulative += weight
        if roll < cumulative:
            return name
    return CATEGORY_WEIGHTS[-1][0]


def _pick(rng: Rng, excluded: set[int]) -> Pairing | None:
    base = _active_pairings(excluded)
    first_choice = _roll_category(rng)
    order = [first_choice] + [name for name, _ in CATEGORY_WEIGHTS if name != first_choice]
    for category in order:
        ids = sorted(_category_queryset(base, category).values_list("id", flat=True))
        if ids:
            return (
                Pairing.objects.select_related("thing", "scale").get(id=rng.choice(ids))
            )
    return None

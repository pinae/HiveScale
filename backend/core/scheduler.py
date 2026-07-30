"""Pairing scheduler (WP-05): which pairing does a player see next?

Two deal *modes* select from the active pool:

- **mixed** (the classic weighted mix, still the default): a 60/30/10 blend of
  well_sampled / under_sampled / fresh (plan §1.6);
- **rotate** (used by the live round loop): a curated/explore rotation that
  keeps the game fun while a large, mostly-unsampled pool graduates. Roughly two
  of every three deals are **curated** — a pairing that already has data, so the
  player is scored against a real crowd; the remaining one **explores** the whole
  pool so data-poor pairings accumulate answers and eventually graduate.
  Within a curated deal, graduated pairings come first; if none exist yet, the
  under-sampled ones *closest to graduating* are pushed so they cross the line.

Design rules:
- The RNG is always injected (``deal(player, rng=...)``) so behavior is fully
  deterministic under test — no hidden randomness. ``mode="rotate"`` rolls the
  curated/explore split from that same RNG.
- Candidate ids are sorted before choosing, so the same RNG state yields the
  same deal regardless of database row order.
- If the chosen bucket has no candidates, the scheduler falls back through the
  remaining buckets rather than failing.
- No repeats within the last ``SESSION_WINDOW`` *answered* pairings, plus any
  ids the client passes in ``exclude_pairing_ids`` (the frontend sends the last
  ~50 dealt, so the backend needn't track per-player history). If that excludes
  everything (tiny databases), the window is relaxed rather than erroring — a
  repeat beats a dead end.
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

#: Fraction of ``rotate`` deals that explore the whole pool (the "1 of 3").
EXPLORE_SHARE = 1 / 3

#: When curating with no graduated pairings yet, choose among the this-many
#: under-sampled pairings nearest the graduation threshold (pushes them over
#: while keeping enough variety that the player doesn't see the same one twice).
CURATED_PUSH_POOL = 12


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
    mode: str = "mixed",
) -> Pairing:
    """Deal the next pairing for ``player``. Read-only; raises
    :class:`NoPairingAvailable` only when no active pairing exists at all.

    ``mode`` is ``"mixed"`` (weighted 60/30/10), ``"curated"``, ``"explore"``,
    or ``"rotate"`` (roll ~2/3 curated, 1/3 explore from ``rng``).
    """
    rng = rng if rng is not None else random
    if mode == "rotate":
        mode = "explore" if rng.random() < EXPLORE_SHARE else "curated"

    excluded = set(recent_pairing_ids(player)) | set(exclude_pairing_ids)

    chosen = _pick(rng, excluded, mode)
    if chosen is None and excluded:
        # Grace fallback: everything active is inside the window — relax it.
        chosen = _pick(rng, set(exclude_pairing_ids), mode)
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


def _get(pairing_id: int) -> Pairing:
    return Pairing.objects.select_related("thing", "scale").get(id=pairing_id)


def _pick(rng: Rng, excluded: set[int], mode: str) -> Pairing | None:
    if mode == "curated":
        return _pick_curated(rng, excluded)
    if mode == "explore":
        return _pick_explore(rng, excluded)
    return _pick_mixed(rng, excluded)


def _pick_mixed(rng: Rng, excluded: set[int]) -> Pairing | None:
    base = _active_pairings(excluded)
    first_choice = _roll_category(rng)
    order = [first_choice] + [name for name, _ in CATEGORY_WEIGHTS if name != first_choice]
    for category in order:
        ids = sorted(_category_queryset(base, category).values_list("id", flat=True))
        if ids:
            return _get(rng.choice(ids))
    return None


def _pick_curated(rng: Rng, excluded: set[int]) -> Pairing | None:
    """A pairing that already carries data, so the round is scored against a real
    crowd. Prefer graduated ones; if none exist yet, push the under-sampled ones
    nearest the graduation threshold; only then fall back to fresh."""
    base = _active_pairings(excluded)

    graduated = sorted(
        _category_queryset(base, "well_sampled").values_list("id", flat=True)
    )
    if graduated:
        return _get(rng.choice(graduated))

    # No baselines yet: bias toward the pairings closest to graduating (most
    # answers) so they cross the line, but keep a small pool for variety.
    nearest = list(
        _category_queryset(base, "under_sampled")
        .order_by("-n_answers", "id")
        .values_list("id", flat=True)[:CURATED_PUSH_POOL]
    )
    if nearest:
        return _get(rng.choice(nearest))

    fresh = sorted(_category_queryset(base, "fresh").values_list("id", flat=True))
    return _get(rng.choice(fresh)) if fresh else None


def _pick_explore(rng: Rng, excluded: set[int]) -> Pairing | None:
    """Any active pairing, drawn uniformly from the whole pool — this is the deal
    that gives data-poor pairings the exposure they need to graduate."""
    ids = sorted(_active_pairings(excluded).values_list("id", flat=True))
    return _get(rng.choice(ids)) if ids else None

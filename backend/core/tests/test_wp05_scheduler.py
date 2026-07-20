"""WP-05 red tests: the pairing scheduler.

Executable spec (docs/baseline-guesser-plan.md, WP-05 + §1.6/§1.7):
- 30/60/10 mix of under-sampled / well-sampled / fresh pairings, verified by a
  chi-squared test over 1,000 deals with a seeded RNG
- deterministic given the injected RNG (no hidden randomness)
- retired content (pairing, thing, or scale) is never dealt
- no repeats within the session window; graceful fallback instead of erroring
  when the window excludes everything
- blind guarantee: the serialized deal contains no distribution data and does
  not reveal freshness (plan §1.7: pioneers must not be told they're pioneers
  before answering)
- deal latency < 30 ms on the seeded demo DB
"""

import random
import time

import pytest
from django.core.management import call_command
from django.utils import timezone

from core.models import ContentStatus, Guess, Pairing, Player, Scale, Thing
from core.scheduler import (
    CATEGORY_WEIGHTS,
    SESSION_WINDOW,
    NoPairingAvailable,
    deal,
    serialize_deal,
)

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_pairing(
    index: int,
    *,
    n_answers: int = 0,
    graduated: bool = False,
    pairing_status: str = ContentStatus.ACTIVE,
    thing_status: str = ContentStatus.ACTIVE,
    scale_status: str = ContentStatus.ACTIVE,
) -> Pairing:
    thing = Thing.objects.create(text=f"Thing {index}", slug=f"thing-{index}", status=thing_status)
    scale = Scale.objects.create(
        left_label=f"left {index}", right_label=f"right {index}",
        slug=f"scale-{index}", status=scale_status,
    )
    return Pairing.objects.create(
        thing=thing,
        scale=scale,
        status=pairing_status,
        n_answers=n_answers,
        graduated_at=timezone.now() if graduated else None,
    )


def _make_mixed_population() -> dict[str, set[int]]:
    """A population where every category is available on every deal."""
    fresh = {_make_pairing(i).pk for i in range(0, 6)}
    under = {_make_pairing(i, n_answers=5).pk for i in range(10, 18)}
    well = {_make_pairing(i, n_answers=30, graduated=True).pk for i in range(20, 32)}
    return {"fresh": fresh, "under_sampled": under, "well_sampled": well}


@pytest.fixture
def player() -> Player:
    return Player.objects.create(device_token="tok-scheduler")


class ScriptedRng:
    """RNG stub: fixed category roll, deterministic first-element choice."""

    def __init__(self, roll: float) -> None:
        self._roll = roll

    def random(self) -> float:
        return self._roll

    def choice(self, seq):
        return seq[0]


# ---------------------------------------------------------------------------
# Mix ratios & determinism
# ---------------------------------------------------------------------------


def test_mix_ratios_match_30_60_10_by_chi_squared(player: Player) -> None:
    population = _make_mixed_population()
    rng = random.Random(42)
    counts = {"fresh": 0, "under_sampled": 0, "well_sampled": 0}
    n = 1000
    for _ in range(n):
        pairing = deal(player, rng=rng)
        for category, ids in population.items():
            if pairing.pk in ids:
                counts[category] += 1
                break

    expected = {name: weight * n for name, weight in CATEGORY_WEIGHTS}
    chi2 = sum((counts[c] - expected[c]) ** 2 / expected[c] for c in expected)
    assert chi2 < 13.82, f"chi2={chi2:.2f}, counts={counts}"  # p ~= 0.001, df=2


def test_deals_are_deterministic_given_a_seeded_rng(player: Player) -> None:
    _make_mixed_population()
    sequence_a = [deal(player, rng=random.Random(7)).pk for _ in range(1)]
    sequence_a += [deal(player, rng=random.Random(7)).pk for _ in range(1)]
    rng1, rng2 = random.Random(99), random.Random(99)
    run1 = [deal(player, rng=rng1).pk for _ in range(50)]
    run2 = [deal(player, rng=rng2).pk for _ in range(50)]
    assert run1 == run2
    assert sequence_a[0] == sequence_a[1]  # same fresh seed, same first deal


def test_category_falls_back_when_its_bucket_is_empty(player: Player) -> None:
    only_graduated = _make_pairing(1, n_answers=30, graduated=True)
    fresh_roll = 1.0 - 1e-9  # would pick the (empty) fresh bucket
    assert deal(player, rng=ScriptedRng(fresh_roll)).pk == only_graduated.pk


# ---------------------------------------------------------------------------
# Retired content & empty database
# ---------------------------------------------------------------------------


def test_retired_content_is_never_dealt(player: Player) -> None:
    _make_pairing(1, pairing_status=ContentStatus.RETIRED)
    _make_pairing(2, thing_status=ContentStatus.RETIRED)
    _make_pairing(3, scale_status=ContentStatus.RETIRED)
    alive = _make_pairing(4)
    rng = random.Random(0)
    assert all(deal(player, rng=rng).pk == alive.pk for _ in range(50))


def test_empty_database_raises_no_pairing_available(player: Player) -> None:
    with pytest.raises(NoPairingAvailable):
        deal(player, rng=random.Random(0))


# ---------------------------------------------------------------------------
# Repeat window
# ---------------------------------------------------------------------------


def _answer(player: Player, pairing: Pairing) -> None:
    Guess.objects.create(
        pairing=pairing, player=player, center=50.0,
        width_left=5.0, width_right=5.0, response_ms=4000,
    )


def test_recently_answered_pairings_are_not_dealt_again(player: Player) -> None:
    pairings = [_make_pairing(i) for i in range(3)]
    _answer(player, pairings[0])
    rng = random.Random(3)
    dealt = {deal(player, rng=rng).pk for _ in range(100)}
    assert pairings[0].pk not in dealt
    assert dealt == {pairings[1].pk, pairings[2].pk}


def test_the_window_slides_after_enough_other_answers(player: Player) -> None:
    pairings = [_make_pairing(i) for i in range(SESSION_WINDOW + 5)]
    first = pairings[0]
    _answer(player, first)
    for other in pairings[1 : SESSION_WINDOW + 1]:  # push `first` out of the window
        _answer(player, other)
    rng = random.Random(11)
    dealt = {deal(player, rng=rng).pk for _ in range(300)}
    assert first.pk in dealt


def test_explicit_exclusions_are_respected(player: Player) -> None:
    pairings = [_make_pairing(i) for i in range(3)]
    rng = random.Random(5)
    dealt = {
        deal(player, rng=rng, exclude_pairing_ids=[pairings[2].pk]).pk for _ in range(100)
    }
    assert pairings[2].pk not in dealt


def test_grace_fallback_relaxes_the_window_rather_than_erroring(player: Player) -> None:
    pairings = [_make_pairing(i) for i in range(2)]
    for pairing in pairings:
        _answer(player, pairing)
    dealt = deal(player, rng=random.Random(1))
    assert dealt.pk in {p.pk for p in pairings}


# ---------------------------------------------------------------------------
# Blind guarantee (plan §1.5/§1.7)
# ---------------------------------------------------------------------------

FORBIDDEN_KEYS = {
    "histogram", "median", "q25", "q75", "n", "n_answers", "graduated",
    "graduated_at", "snapshot", "snapshots", "ai", "ai_distributions",
    "model_name", "rationale", "is_fresh", "status",
}


def _all_keys(payload) -> set[str]:
    keys: set[str] = set()
    if isinstance(payload, dict):
        for key, value in payload.items():
            keys.add(key)
            keys |= _all_keys(value)
    elif isinstance(payload, list):
        for item in payload:
            keys |= _all_keys(item)
    return keys


def test_serialized_deal_is_blind(player: Player) -> None:
    _make_pairing(1, n_answers=30, graduated=True)
    pairing = deal(player, rng=random.Random(0))
    payload = serialize_deal(pairing)

    assert payload["pairing_id"] == pairing.pk
    assert payload["thing"] == {"text": "Thing 1"}
    assert payload["scale"] == {"left": "left 1", "right": "right 1"}
    assert _all_keys(payload) & FORBIDDEN_KEYS == set()


def test_fresh_and_graduated_deals_are_indistinguishable(player: Player) -> None:
    """Pioneers must not be able to tell they are pioneers before answering."""
    fresh = _make_pairing(1)
    graduated = _make_pairing(2, n_answers=30, graduated=True)
    fresh_keys = set(serialize_deal(fresh).keys())
    graduated_keys = set(serialize_deal(graduated).keys())
    assert fresh_keys == graduated_keys


# ---------------------------------------------------------------------------
# Latency (WP-05 acceptance)
# ---------------------------------------------------------------------------


def test_deal_latency_under_30ms_on_the_seeded_demo_db() -> None:
    call_command("seed_demo")
    player = Player.objects.first()
    rng = random.Random(123)
    deal(player, rng=rng)  # warm-up
    start = time.perf_counter()
    n = 100
    for _ in range(n):
        deal(player, rng=rng)
    average_ms = (time.perf_counter() - start) / n * 1000
    assert average_ms < 30, f"average deal latency {average_ms:.1f} ms"

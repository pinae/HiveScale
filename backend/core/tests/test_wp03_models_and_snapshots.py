"""WP-03 red tests: domain models, snapshot recomputation, demo seed.

Executable spec (docs/hivescale-plan.md, WP-03):
- snapshot median/quartiles on a 50-guess fixture match a numpy reference
- flagged, too-fast, and zero-weight guesses are excluded from the baseline
- ``Guess`` rows are immutable (saving an existing row raises)
- (thing, scale) pairings are unique
- ``manage.py seed_demo`` creates 20 Things, 10 Scales, 60 pairings with
  plausible synthetic guesses
"""

import random

import numpy as np
import pytest
from django.core.management import CommandError, call_command
from django.db import IntegrityError

from bglib.scoring import weighted_quantile
from core.models import (
    AIDistribution,
    DistributionSnapshot,
    Guess,
    Pairing,
    Player,
    Scale,
    Thing,
)
from core.services import (
    N_MIN_GRADUATION,
    SPEED_FLOOR_MS,
    recompute_snapshot,
)

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def pairing() -> Pairing:
    thing = Thing.objects.create(text="Robotic lawnmower", slug="robotic-lawnmower")
    scale = Scale.objects.create(
        left_label="sophisticated",
        right_label="overly complicated",
        slug="sophisticated-overly-complicated",
    )
    return Pairing.objects.create(thing=thing, scale=scale)


@pytest.fixture
def player() -> Player:
    return Player.objects.create(device_token="tok-main")


def _make_guess(pairing: Pairing, player: Player, center: float, **overrides) -> Guess:
    fields = {
        "pairing": pairing,
        "player": player,
        "center": center,
        "width_left": 10.0,
        "width_right": 10.0,
        "response_ms": 4000,
    }
    fields.update(overrides)
    return Guess.objects.create(**fields)


# ---------------------------------------------------------------------------
# weighted_quantile (pure helper used by the snapshot service)
# ---------------------------------------------------------------------------


def test_weighted_quantile_matches_numpy_linear_for_equal_weights() -> None:
    rng = random.Random(7)
    values = [rng.uniform(0, 100) for _ in range(50)]
    weights = [1.0] * 50
    for q in (0.25, 0.5, 0.75, 0.9):
        assert weighted_quantile(values, weights, q) == pytest.approx(
            float(np.percentile(values, q * 100, method="hazen")), abs=1e-9
        )


def test_weighted_quantile_is_pulled_by_heavier_weights() -> None:
    values = [10.0, 90.0]
    balanced = weighted_quantile(values, [1.0, 1.0], 0.5)
    skewed = weighted_quantile(values, [1.0, 9.0], 0.5)
    assert skewed > balanced


def test_weighted_quantile_handles_single_value_and_rejects_bad_input() -> None:
    assert weighted_quantile([42.0], [3.0], 0.5) == 42.0
    with pytest.raises(ValueError):
        weighted_quantile([], [], 0.5)
    with pytest.raises(ValueError):
        weighted_quantile([1.0], [1.0, 2.0], 0.5)
    with pytest.raises(ValueError):
        weighted_quantile([1.0], [1.0], 1.5)


# ---------------------------------------------------------------------------
# Model integrity
# ---------------------------------------------------------------------------


def test_guess_rows_are_immutable(pairing: Pairing, player: Player) -> None:
    guess = _make_guess(pairing, player, center=42.0)
    guess.center = 99.0
    with pytest.raises(TypeError):
        guess.save()
    guess.refresh_from_db()
    assert guess.center == 42.0


def test_guess_center_must_be_on_scale(pairing: Pairing, player: Player) -> None:
    with pytest.raises(IntegrityError):
        _make_guess(pairing, player, center=101.0)


def test_guess_widths_must_be_non_negative(pairing: Pairing, player: Player) -> None:
    with pytest.raises(IntegrityError):
        _make_guess(pairing, player, center=50.0, width_left=-1.0)


def test_pairing_is_unique_per_thing_and_scale(pairing: Pairing) -> None:
    with pytest.raises(IntegrityError):
        Pairing.objects.create(thing=pairing.thing, scale=pairing.scale)


# ---------------------------------------------------------------------------
# recompute_snapshot
# ---------------------------------------------------------------------------


def test_snapshot_stats_match_numpy_reference_on_50_guesses(
    pairing: Pairing, player: Player
) -> None:
    rng = random.Random(2026)
    centers = [min(100.0, max(0.0, rng.gauss(58, 14))) for _ in range(50)]
    for center in centers:
        _make_guess(pairing, player, center=center)

    snapshot = recompute_snapshot(pairing)

    assert snapshot.n == 50
    assert snapshot.median == pytest.approx(
        float(np.percentile(centers, 50, method="hazen")), abs=1e-9
    )
    assert snapshot.q25 == pytest.approx(
        float(np.percentile(centers, 25, method="hazen")), abs=1e-9
    )
    assert snapshot.q75 == pytest.approx(
        float(np.percentile(centers, 75, method="hazen")), abs=1e-9
    )
    assert len(snapshot.histogram) == 20
    assert sum(snapshot.histogram) == pytest.approx(1.0)
    assert DistributionSnapshot.objects.filter(pairing=pairing).count() == 1


def test_snapshot_excludes_flagged_fast_and_zero_weight_guesses(
    pairing: Pairing, player: Player
) -> None:
    clean_centers = [20.0, 30.0, 40.0, 50.0, 60.0]
    for center in clean_centers:
        _make_guess(pairing, player, center=center)

    ghost = Player.objects.create(device_token="tok-ghost", weight=0.0)
    _make_guess(pairing, player, center=100.0, quality_flags=["too_fast"])
    _make_guess(pairing, player, center=100.0, response_ms=SPEED_FLOOR_MS - 1)
    _make_guess(pairing, ghost, center=100.0)

    snapshot = recompute_snapshot(pairing)

    assert snapshot.n == len(clean_centers)
    assert snapshot.median == pytest.approx(float(np.percentile(clean_centers, 50, method="hazen")))
    assert snapshot.q75 == pytest.approx(float(np.percentile(clean_centers, 75, method="hazen")))
    assert snapshot.histogram[-1] == 0.0  # the excluded 100s left no trace


def test_snapshot_respects_fractional_player_weights(pairing: Pairing, player: Player) -> None:
    heavy = Player.objects.create(device_token="tok-heavy", weight=3.0)
    _make_guess(pairing, player, center=10.0)
    _make_guess(pairing, heavy, center=90.0)
    snapshot = recompute_snapshot(pairing)
    assert snapshot.median > 50.0  # pulled toward the heavier player


def test_snapshot_requires_at_least_one_eligible_guess(pairing: Pairing, player: Player) -> None:
    _make_guess(pairing, player, center=50.0, quality_flags=["too_fast"])
    with pytest.raises(ValueError):
        recompute_snapshot(pairing)


def test_backfill_fills_a_stale_snapshot_missing_its_belief(
    pairing: Pairing, player: Player
) -> None:
    # Regression: snapshots computed before the belief field existed have an empty
    # belief_histogram, which vanishes the reveal curve and makes belief_match
    # collapse onto means_match. The backfill repopulates them from the guesses.
    from core.services import backfill_missing_belief_histograms

    for _ in range(6):
        _make_guess(pairing, player, center=30.0, width_left=8, width_right=8)
    snapshot = recompute_snapshot(pairing)
    snapshot.belief_histogram = []  # simulate a pre-feature snapshot
    snapshot.save(update_fields=["belief_histogram"])

    assert backfill_missing_belief_histograms() == 1
    snapshot.refresh_from_db()
    assert len(snapshot.belief_histogram) == 20
    assert sum(snapshot.belief_histogram) == pytest.approx(1.0)
    # Idempotent: a second run touches nothing.
    assert backfill_missing_belief_histograms() == 0


def test_snapshot_belief_histogram_sums_the_full_guesses(pairing: Pairing, player: Player) -> None:
    # Two camps, each guessing a tight bell -> the summed belief is bimodal and
    # normalized, distinct from the (also bimodal) histogram of bare means.
    left = Player.objects.create(device_token="tok-left")
    for _ in range(5):
        _make_guess(pairing, player, center=15.0, width_left=4, width_right=4)
        _make_guess(pairing, left, center=85.0, width_left=4, width_right=4)

    snapshot = recompute_snapshot(pairing)
    assert len(snapshot.belief_histogram) == 20
    assert sum(snapshot.belief_histogram) == pytest.approx(1.0)
    # Mass concentrates in the two camps' buckets (≈15 -> bucket 3, ≈85 -> 17).
    assert snapshot.belief_histogram[3] > 0.1
    assert snapshot.belief_histogram[17] > 0.1
    assert snapshot.belief_histogram[10] < 0.05  # little belief mass in the middle


def test_snapshot_updates_pairing_answer_count_and_graduation(
    pairing: Pairing, player: Player
) -> None:
    for i in range(N_MIN_GRADUATION - 1):
        _make_guess(pairing, player, center=40.0 + i)
    recompute_snapshot(pairing)
    pairing.refresh_from_db()
    assert pairing.n_answers == N_MIN_GRADUATION - 1
    assert pairing.graduated_at is None

    _make_guess(pairing, player, center=55.0)
    recompute_snapshot(pairing)
    pairing.refresh_from_db()
    assert pairing.n_answers == N_MIN_GRADUATION
    assert pairing.graduated_at is not None

    first_graduation = pairing.graduated_at
    _make_guess(pairing, player, center=56.0)
    recompute_snapshot(pairing)
    pairing.refresh_from_db()
    assert pairing.graduated_at == first_graduation  # graduation is permanent


def test_ai_distributions_never_leak_into_snapshots(pairing: Pairing, player: Player) -> None:
    """The human baseline must stay purely human (plan §1.5)."""
    AIDistribution.objects.create(
        pairing=pairing,
        model_name="gemini-test",
        prompt_version="v1",
        histogram=[0.05] * 20,
        median=95.0,
        q25=90.0,
        q75=99.0,
        rationale="canned",
    )
    for center in (10.0, 20.0, 30.0):
        _make_guess(pairing, player, center=center)
    snapshot = recompute_snapshot(pairing)
    assert snapshot.n == 3
    assert snapshot.median == pytest.approx(20.0)


# ---------------------------------------------------------------------------
# seed_demo
# ---------------------------------------------------------------------------


def test_seed_demo_creates_the_promised_dataset() -> None:
    call_command("seed_demo")

    assert Thing.objects.count() == 20
    assert Scale.objects.count() == 10
    assert Pairing.objects.count() == 60
    assert Player.objects.count() > 0
    assert Guess.objects.count() > 0

    assert not Guess.objects.filter(center__lt=0).exists()
    assert not Guess.objects.filter(center__gt=100).exists()

    graduated = Pairing.objects.filter(graduated_at__isnull=False)
    assert graduated.exists()
    for pairing in graduated:
        snapshot = DistributionSnapshot.objects.filter(pairing=pairing).latest("computed_at")
        assert snapshot.n >= N_MIN_GRADUATION


def test_seed_demo_is_deterministic_across_databases() -> None:
    call_command("seed_demo")
    fingerprint = list(
        Guess.objects.order_by("id").values_list("center", flat=True)[:20]
    )
    call_command("seed_demo", reset=True)
    assert fingerprint == list(
        Guess.objects.order_by("id").values_list("center", flat=True)[:20]
    )


def test_seed_demo_refuses_to_clobber_existing_data_without_reset() -> None:
    call_command("seed_demo")
    with pytest.raises(CommandError):
        call_command("seed_demo")

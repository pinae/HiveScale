"""WP-02 red tests: the pure scoring library.

These tests are the executable specification for ``bglib.scoring`` and are
committed BEFORE the implementation exists (TDD red).

Covered properties (from docs/hivescale-plan.md, WP-02):
- CRPS non-negative, and zero exactly at the true distribution
- visible score always within [0, 1000]
- distance component strictly monotonic in distance to the crowd median
- calibration bonus decreasing in interval width once the crowd IQR is covered
- bimodality detector flags synthetic two-peak histograms, not unimodal ones
Plus targeted example tests for edge cases and the calibration-stats fold.
"""

import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from bglib.scoring import (
    N_BUCKETS,
    BimodalityReport,
    CalibrationStats,
    Guess,
    HistogramDist,
    ScoreBreakdown,
    SnapshotStats,
    build_histogram,
    calibration_update,
    crps,
    detect_bimodality,
    guess_to_distribution,
    quantile_from_histogram,
    visible_score,
)

# ---------------------------------------------------------------------------
# Hypothesis strategies
# ---------------------------------------------------------------------------

centers = st.floats(min_value=0, max_value=100, allow_nan=False, allow_infinity=False)
widths = st.floats(min_value=0, max_value=100, allow_nan=False, allow_infinity=False)


@st.composite
def guesses(draw) -> Guess:
    return Guess(
        center=draw(centers),
        width_left=draw(widths),
        width_right=draw(widths),
    )


@st.composite
def histograms(draw) -> tuple[float, ...]:
    raw = draw(
        st.lists(
            st.floats(min_value=1e-4, max_value=1.0, allow_nan=False),
            min_size=N_BUCKETS,
            max_size=N_BUCKETS,
        )
    )
    total = sum(raw)
    return tuple(w / total for w in raw)


@st.composite
def snapshots(draw) -> SnapshotStats:
    hist = draw(histograms())
    return SnapshotStats(
        median=quantile_from_histogram(hist, 0.5),
        q25=quantile_from_histogram(hist, 0.25),
        q75=quantile_from_histogram(hist, 0.75),
    )


# ---------------------------------------------------------------------------
# guess_to_distribution
# ---------------------------------------------------------------------------


@given(guesses())
def test_guess_distribution_cdf_is_a_cdf(guess: Guess) -> None:
    dist = guess_to_distribution(guess)
    assert dist.cdf(-1) == 0.0
    assert dist.cdf(101) == 1.0
    previous = 0.0
    for x in range(0, 101):
        value = dist.cdf(float(x))
        assert 0.0 <= value <= 1.0
        assert value >= previous - 1e-12  # monotone non-decreasing
        previous = value


def test_zero_width_guess_gets_a_sharp_finite_bell_not_a_crash() -> None:
    dist = guess_to_distribution(Guess(center=50, width_left=0, width_right=0))
    # Floored sigma -> a sharp, symmetric, finite bell centred at 50.
    assert dist.cdf(50) == pytest.approx(0.5)
    assert 0.0 < dist.cdf(49) < 0.5 < dist.cdf(51) < 1.0
    assert dist.cdf(45) < dist.cdf(49)  # further out, less mass below


def test_mass_is_renormalized_onto_the_scale_at_an_extreme() -> None:
    # Centre pinned near the left wall: the left tail is truncated, so almost all
    # the (renormalized) mass sits to the right of the mode — a decided half-bell.
    dist = guess_to_distribution(Guess(center=2, width_left=50, width_right=50))
    assert dist.cdf(0) == 0.0  # nothing below the scale
    assert dist.cdf(100) == 1.0  # all mass fits on the scale (renormalized)
    assert dist.cdf(2) < 0.1  # only a sliver of mass below the mode at the wall


@pytest.mark.parametrize(
    "center,wl,wr",
    [(-1, 5, 5), (101, 5, 5), (50, -1, 5), (50, 5, -1)],
)
def test_invalid_guesses_are_rejected(center: float, wl: float, wr: float) -> None:
    with pytest.raises(ValueError):
        guess_to_distribution(Guess(center=center, width_left=wl, width_right=wr))


# ---------------------------------------------------------------------------
# CRPS (Cramér-distance form)
# ---------------------------------------------------------------------------


@given(guesses(), histograms())
def test_crps_is_non_negative(guess: Guess, hist: tuple[float, ...]) -> None:
    assert crps(guess_to_distribution(guess), hist) >= 0.0


@given(histograms())
def test_crps_is_zero_exactly_at_the_true_distribution(hist: tuple[float, ...]) -> None:
    """Forecasting the crowd's own CDF is the unique perfect forecast."""
    assert crps(HistogramDist(hist), hist) == pytest.approx(0.0, abs=1e-9)


@given(histograms())
def test_crps_punishes_a_confidently_wrong_forecast(hist: tuple[float, ...]) -> None:
    truth = HistogramDist(hist)
    median = quantile_from_histogram(hist, 0.5)
    far_center = 5.0 if median > 50 else 95.0
    wrong = guess_to_distribution(Guess(center=far_center, width_left=2, width_right=2))
    assert crps(wrong, hist) > crps(truth, hist)


# ---------------------------------------------------------------------------
# visible_score
# ---------------------------------------------------------------------------


@given(guesses(), snapshots())
def test_visible_score_is_bounded(guess: Guess, snapshot: SnapshotStats) -> None:
    breakdown = visible_score(guess, snapshot)
    assert isinstance(breakdown, ScoreBreakdown)
    assert 0 <= breakdown.total <= 1000
    assert 0 <= breakdown.distance_points
    assert 0 <= breakdown.calibration_points
    assert breakdown.total == breakdown.distance_points + breakdown.calibration_points


@given(snapshots(), st.floats(min_value=0, max_value=49.9), st.floats(min_value=0.1, max_value=50))
def test_distance_points_strictly_decrease_with_distance(
    snapshot: SnapshotStats, d1: float, extra: float
) -> None:
    d2 = d1 + extra
    for sign in (+1, -1):
        c1 = snapshot.median + sign * d1
        c2 = snapshot.median + sign * d2
        if not (0 <= c1 <= 100 and 0 <= c2 <= 100):
            continue
        near = visible_score(Guess(c1, 10, 10), snapshot)
        far = visible_score(Guess(c2, 10, 10), snapshot)
        assert near.distance_points > far.distance_points


@given(snapshots(), st.floats(min_value=0.5, max_value=30))
def test_calibration_bonus_decreases_with_width_once_iqr_is_covered(
    snapshot: SnapshotStats, extra: float
) -> None:
    """Tight-and-right must beat loose-and-right (the risk dial)."""
    iqr_half = max(
        snapshot.median - snapshot.q25,
        snapshot.q75 - snapshot.median,
    )
    tight = Guess(snapshot.median, iqr_half + 1, iqr_half + 1)
    loose = Guess(snapshot.median, iqr_half + 1 + extra, iqr_half + 1 + extra)
    tight_score = visible_score(tight, snapshot)
    loose_score = visible_score(loose, snapshot)
    assert tight_score.covered_fraction == pytest.approx(1.0)
    assert loose_score.covered_fraction == pytest.approx(1.0)
    assert tight_score.calibration_points > loose_score.calibration_points


def test_missing_the_iqr_entirely_earns_no_calibration_points() -> None:
    snapshot = SnapshotStats(median=80.0, q25=70.0, q75=90.0)
    breakdown = visible_score(Guess(center=10, width_left=5, width_right=5), snapshot)
    assert breakdown.covered_fraction == 0.0
    assert breakdown.calibration_points == 0


def test_partial_iqr_coverage_earns_partial_calibration_points() -> None:
    snapshot = SnapshotStats(median=50.0, q25=40.0, q75=60.0)
    half_covering = Guess(center=40, width_left=5, width_right=10)  # covers [35, 50]
    breakdown = visible_score(half_covering, snapshot)
    assert 0.0 < breakdown.covered_fraction < 1.0
    full = visible_score(Guess(center=50, width_left=15, width_right=15), snapshot)
    assert 0 < breakdown.calibration_points < full.calibration_points


def test_degenerate_iqr_counts_as_covered_when_inside_the_interval() -> None:
    snapshot = SnapshotStats(median=50.0, q25=50.0, q75=50.0)
    inside = visible_score(Guess(center=50, width_left=3, width_right=3), snapshot)
    outside = visible_score(Guess(center=10, width_left=3, width_right=3), snapshot)
    assert inside.covered_fraction == 1.0
    assert outside.covered_fraction == 0.0


# ---------------------------------------------------------------------------
# calibration_update (pure fold over rounds)
# ---------------------------------------------------------------------------


def test_calibration_update_counts_hits_and_widths_immutably() -> None:
    stats0 = CalibrationStats()
    snapshot = SnapshotStats(median=50.0, q25=45.0, q75=55.0)

    stats1 = calibration_update(stats0, Guess(48, 5, 5), snapshot)  # hit (45..53)
    stats2 = calibration_update(stats1, Guess(10, 2, 2), snapshot)  # miss (8..12)
    stats3 = calibration_update(stats2, Guess(55, 5, 0), snapshot)  # hit at boundary

    assert stats0 == CalibrationStats()  # inputs never mutated
    assert (stats3.n, stats3.hits) == (3, 2)
    assert stats3.hit_rate == pytest.approx(2 / 3)
    assert stats3.mean_width == pytest.approx((10 + 4 + 5) / 3)


def test_empty_calibration_stats_have_safe_defaults() -> None:
    stats = CalibrationStats()
    assert stats.hit_rate == 0.0
    assert stats.mean_width == 0.0


# ---------------------------------------------------------------------------
# Histogram helpers
# ---------------------------------------------------------------------------


def test_build_histogram_normalizes_and_buckets_edge_values() -> None:
    hist = build_histogram([0.0, 4.9, 5.0, 99.9, 100.0])
    assert len(hist) == N_BUCKETS
    assert sum(hist) == pytest.approx(1.0)
    assert hist[0] == pytest.approx(2 / 5)  # 0.0 and 4.9
    assert hist[1] == pytest.approx(1 / 5)  # 5.0
    assert hist[-1] == pytest.approx(2 / 5)  # 99.9 and 100.0 (top edge inclusive)


def test_build_histogram_supports_weights() -> None:
    hist = build_histogram([10.0, 90.0], weights=[3.0, 1.0])
    assert hist[2] == pytest.approx(0.75)
    assert hist[18] == pytest.approx(0.25)


def test_build_histogram_rejects_empty_and_bad_input() -> None:
    with pytest.raises(ValueError):
        build_histogram([])
    with pytest.raises(ValueError):
        build_histogram([50.0], weights=[1.0, 2.0])
    with pytest.raises(ValueError):
        build_histogram([123.0])


@given(histograms(), st.floats(min_value=0.01, max_value=0.99))
def test_quantiles_are_monotone_and_in_range(hist: tuple[float, ...], q: float) -> None:
    value = quantile_from_histogram(hist, q)
    assert 0.0 <= value <= 100.0
    assert quantile_from_histogram(hist, min(0.99, q + 0.01)) >= value - 1e-9


def test_quantile_lands_on_bucket_edge_when_mass_is_concentrated() -> None:
    """Zero-weight buckets are skipped; quantiles inside a point mass stay put."""
    hist = tuple(1.0 if i == 10 else 0.0 for i in range(N_BUCKETS))
    assert quantile_from_histogram(hist, 0.5) == pytest.approx(52.5)
    assert quantile_from_histogram(hist, 0.99) <= 55.0


def test_quantile_rejects_out_of_range_q() -> None:
    hist = build_histogram([50.0])
    with pytest.raises(ValueError):
        quantile_from_histogram(hist, 0.0)
    with pytest.raises(ValueError):
        quantile_from_histogram(hist, 1.5)


# ---------------------------------------------------------------------------
# Bimodality
# ---------------------------------------------------------------------------


def _hist_from_bucket_weights(weights: dict[int, float]) -> tuple[float, ...]:
    raw = [weights.get(i, 0.01) for i in range(N_BUCKETS)]
    total = sum(raw)
    return tuple(w / total for w in raw)


def test_two_camps_are_detected_as_bimodal() -> None:
    hist = _hist_from_bucket_weights({3: 1.0, 4: 1.2, 5: 1.0, 14: 1.0, 15: 1.3, 16: 1.0})
    report = detect_bimodality(hist)
    assert isinstance(report, BimodalityReport)
    assert report.is_bimodal
    assert len(report.peaks) == 2
    left, right = report.peaks
    assert left < 40 and right > 60  # peak positions on the 0-100 scale


def test_a_single_consensus_peak_is_not_bimodal() -> None:
    weights = {i: math.exp(-((i - 10) ** 2) / 8) for i in range(N_BUCKETS)}
    report = detect_bimodality(_hist_from_bucket_weights(weights))
    assert not report.is_bimodal


def test_uniform_indifference_is_not_bimodal() -> None:
    report = detect_bimodality(tuple(1 / N_BUCKETS for _ in range(N_BUCKETS)))
    assert not report.is_bimodal


def test_twin_peaks_without_a_dip_between_them_are_one_camp() -> None:
    """Adjacent humps with a shallow valley are one broad opinion, not a split."""
    weights = {7: 1.0, 8: 0.95, 9: 1.0}
    report = detect_bimodality(_hist_from_bucket_weights(weights))
    assert not report.is_bimodal


def test_bimodality_rejects_malformed_histograms() -> None:
    with pytest.raises(ValueError):
        detect_bimodality((0.5, 0.5))  # wrong bucket count
    with pytest.raises(ValueError):
        detect_bimodality(tuple([-0.1] + [1.1 / (N_BUCKETS - 1)] * (N_BUCKETS - 1)))
    with pytest.raises(ValueError):
        detect_bimodality(tuple(0.5 / N_BUCKETS for _ in range(N_BUCKETS)))  # sums to 0.5


def test_camps_too_close_together_are_not_bimodal() -> None:
    """Two sharp peaks 3 buckets apart are one wobbly camp, not a split."""
    hist = _hist_from_bucket_weights({8: 1.0, 11: 1.0})
    assert not detect_bimodality(hist).is_bimodal


def test_three_camps_report_the_deepest_split() -> None:
    hist = _hist_from_bucket_weights({2: 1.0, 9: 0.9, 17: 1.0})
    report = detect_bimodality(hist)
    assert report.is_bimodal
    assert len(report.peaks) == 2

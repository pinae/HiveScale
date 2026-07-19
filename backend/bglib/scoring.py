"""Pure scoring library for Baseline Guesser (WP-02).

Zero Django imports — usable from API views, Celery workers, and analysis
notebooks alike. All functions are deterministic and side-effect free.

Concepts
--------
- The scale is continuous ``[0, 100]``.
- The crowd baseline is a normalized histogram with ``N_BUCKETS`` (20) equal
  buckets of width 5, plus robust summary stats (median, q25, q75).
- A player's guess is ``(center, width_left, width_right)`` and is interpreted
  as an asymmetric triangular distribution peaked at ``center`` with support
  ``[center - width_left, center + width_right]`` clamped to the scale.

Scoring formulas (for the game-design team)
-------------------------------------------
Visible per-round score = ``distance_points + calibration_points`` ∈ [0, 1000].

1. ``distance_points = 600 * exp(-(d / 18)^2)`` where ``d = |center - median|``.
   A generous bell: ~556 pts at d=5, ~440 at d=10, ~175 at d=20. Strictly
   decreasing in d, never negative, maximum 600 at a perfect median hit.

2. ``calibration_points = 400 * covered_fraction * exp(-width / 150)`` where
   ``covered_fraction`` is the share of the crowd IQR ``[q25, q75]`` that lies
   inside the player's (clamped) interval, and ``width = width_left +
   width_right`` (nominal). Tight *and* right pays most; widening the interval
   always costs points (the "risk dial"), but coverage is required to earn
   anything at all.

Hidden skill metric: ``crps`` — the Cramér distance ``∫ (F(x) - G(x))² dx``
between the player's forecast CDF F and the crowd CDF G. This is the
F-dependent part of the expected CRPS proper scoring rule, so honest reporting
of one's true belief is the optimal strategy; it is 0 exactly when F = G.
Lower is better. Used for leagues, archetypes, and troll down-weighting —
never shown raw to players.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, replace

SCALE_MAX = 100.0
N_BUCKETS = 20
BUCKET_WIDTH = SCALE_MAX / N_BUCKETS

DISTANCE_MAX_POINTS = 600.0
DISTANCE_SOFTNESS = 18.0
CALIBRATION_MAX_POINTS = 400.0
CALIBRATION_WIDTH_SOFTNESS = 150.0

_CRPS_STEP = 0.1
_MIN_HALF_SUPPORT = 0.5
_EPS = 1e-9


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Guess:
    """A single player answer: point estimate plus confidence interval."""

    center: float
    width_left: float
    width_right: float

    @property
    def nominal_width(self) -> float:
        return self.width_left + self.width_right

    def clamped_interval(self) -> tuple[float, float]:
        return (
            max(0.0, self.center - self.width_left),
            min(SCALE_MAX, self.center + self.width_right),
        )


@dataclass(frozen=True, slots=True)
class SnapshotStats:
    """Robust summary of the crowd distribution used as the scoring target."""

    median: float
    q25: float
    q75: float


@dataclass(frozen=True, slots=True)
class ScoreBreakdown:
    """Visible-score components; ``total`` is what the player sees count up."""

    distance_points: float
    calibration_points: float
    total: float
    covered_fraction: float


@dataclass(frozen=True, slots=True)
class CalibrationStats:
    """Running calibration record, folded one round at a time."""

    n: int = 0
    hits: int = 0
    total_width: float = 0.0

    @property
    def hit_rate(self) -> float:
        return self.hits / self.n if self.n else 0.0

    @property
    def mean_width(self) -> float:
        return self.total_width / self.n if self.n else 0.0


@dataclass(frozen=True, slots=True)
class BimodalityReport:
    """Result of the society-is-split detector (drives special reveal copy)."""

    is_bimodal: bool
    peaks: tuple[float, ...]
    dip_ratio: float


# ---------------------------------------------------------------------------
# Distributions
# ---------------------------------------------------------------------------


class TriangularDist:
    """Asymmetric triangular distribution on ``[left, right]`` peaked at mode."""

    def __init__(self, left: float, mode: float, right: float) -> None:
        span = right - left
        # Keep the mode strictly interior so the CDF has one uniform formula.
        self.left = left
        self.right = right
        self.mode = min(max(mode, left + _EPS * span), right - _EPS * span)

    def cdf(self, x: float) -> float:
        if x <= self.left:
            return 0.0
        if x >= self.right:
            return 1.0
        span = self.right - self.left
        if x <= self.mode:
            return (x - self.left) ** 2 / (span * (self.mode - self.left))
        return 1.0 - (self.right - x) ** 2 / (span * (self.right - self.mode))


class HistogramDist:
    """Piecewise-linear CDF of a normalized ``N_BUCKETS`` histogram."""

    def __init__(self, histogram: Sequence[float]) -> None:
        _validate_histogram(histogram)
        self._weights = tuple(histogram)
        cumulative = []
        running = 0.0
        for weight in self._weights:
            running += weight
            cumulative.append(running)
        self._cumulative = tuple(cumulative)

    def cdf(self, x: float) -> float:
        if x <= 0.0:
            return 0.0
        if x >= SCALE_MAX:
            return 1.0
        index = min(N_BUCKETS - 1, int(x / BUCKET_WIDTH))
        before = self._cumulative[index - 1] if index else 0.0
        fraction = (x - index * BUCKET_WIDTH) / BUCKET_WIDTH
        return before + fraction * self._weights[index]


def guess_to_distribution(guess: Guess) -> TriangularDist:
    """Interpret a guess as its forecast distribution (validates the guess)."""
    _validate_guess(guess)
    left, right = guess.clamped_interval()
    if right - left < 2 * _MIN_HALF_SUPPORT:
        left = max(0.0, guess.center - _MIN_HALF_SUPPORT)
        right = min(SCALE_MAX, guess.center + _MIN_HALF_SUPPORT)
    return TriangularDist(left, guess.center, right)


# ---------------------------------------------------------------------------
# Scores
# ---------------------------------------------------------------------------


def crps(dist: TriangularDist | HistogramDist, histogram: Sequence[float]) -> float:
    """Cramér distance ``∫ (F - G)² dx`` between forecast F and crowd G.

    Non-negative; zero exactly when the forecast CDF equals the crowd CDF.
    See the module docstring for why this is incentive-compatible.
    """
    crowd = histogram if isinstance(histogram, HistogramDist) else HistogramDist(histogram)
    steps = int(SCALE_MAX / _CRPS_STEP)
    total = 0.0
    for i in range(steps + 1):
        x = i * _CRPS_STEP
        diff = dist.cdf(x) - crowd.cdf(x)
        weight = 0.5 if i in (0, steps) else 1.0
        total += weight * diff * diff
    return total * _CRPS_STEP


def visible_score(guess: Guess, snapshot: SnapshotStats) -> ScoreBreakdown:
    """The 0-1000 per-round score shown to players (formula in module docstring)."""
    _validate_guess(guess)
    distance = abs(guess.center - snapshot.median)
    distance_points = DISTANCE_MAX_POINTS * math.exp(-((distance / DISTANCE_SOFTNESS) ** 2))

    covered = _covered_fraction(guess, snapshot)
    tightness = math.exp(-guess.nominal_width / CALIBRATION_WIDTH_SOFTNESS)
    calibration_points = CALIBRATION_MAX_POINTS * covered * tightness

    return ScoreBreakdown(
        distance_points=distance_points,
        calibration_points=calibration_points,
        total=distance_points + calibration_points,
        covered_fraction=covered,
    )


def calibration_update(
    stats: CalibrationStats, guess: Guess, snapshot: SnapshotStats
) -> CalibrationStats:
    """Fold one round into a player's running calibration record (pure)."""
    low, high = guess.clamped_interval()
    hit = low <= snapshot.median <= high
    return replace(
        stats,
        n=stats.n + 1,
        hits=stats.hits + (1 if hit else 0),
        total_width=stats.total_width + guess.nominal_width,
    )


# ---------------------------------------------------------------------------
# Histogram helpers (shared with WP-03 snapshot recomputation)
# ---------------------------------------------------------------------------


def build_histogram(
    values: Sequence[float], weights: Sequence[float] | None = None
) -> tuple[float, ...]:
    """Normalized ``N_BUCKETS`` histogram of guess centers, optionally weighted."""
    if not values:
        raise ValueError("cannot build a histogram from zero values")
    if weights is not None and len(weights) != len(values):
        raise ValueError("weights must match values in length")
    buckets = [0.0] * N_BUCKETS
    for i, value in enumerate(values):
        if not 0.0 <= value <= SCALE_MAX:
            raise ValueError(f"value {value} outside the [0, {SCALE_MAX}] scale")
        index = min(N_BUCKETS - 1, int(value / BUCKET_WIDTH))
        buckets[index] += weights[i] if weights is not None else 1.0
    total = sum(buckets)
    return tuple(b / total for b in buckets)


def weighted_quantile(values: Sequence[float], weights: Sequence[float], q: float) -> float:
    """Weighted Hazen quantile: inverts the piecewise-linear CDF through the
    points ``(x_i, (S_i - w_i/2) / S_n)`` where ``S_i`` are cumulative weights
    over the value-sorted sample.

    For equal weights this reduces exactly to ``numpy.percentile(...,
    method="hazen")``. Unlike the weighted "type 7" generalization, it is not
    degenerate for small n, so fractional player weights (troll down-weighting)
    actually move the crowd stats. Quantiles outside the outermost plotting
    positions clamp to the extreme values.
    """
    if not values:
        raise ValueError("cannot take a quantile of zero values")
    if len(weights) != len(values):
        raise ValueError("weights must match values in length")
    if not 0.0 < q < 1.0:
        raise ValueError("q must be strictly between 0 and 1")
    if any(w <= 0.0 for w in weights):
        raise ValueError("weights must be strictly positive")

    pairs = sorted(zip(values, weights, strict=True))
    total = sum(w for _, w in pairs)
    positions: list[float] = []
    running = 0.0
    for _, weight in pairs:
        running += weight
        positions.append((running - weight / 2.0) / total)

    if q <= positions[0]:
        return pairs[0][0]
    if q >= positions[-1]:
        return pairs[-1][0]
    for i in range(1, len(pairs)):
        if q <= positions[i]:
            span = positions[i] - positions[i - 1]
            t = (q - positions[i - 1]) / span
            return pairs[i - 1][0] + t * (pairs[i][0] - pairs[i - 1][0])
    return pairs[-1][0]  # pragma: no cover - unreachable


def quantile_from_histogram(histogram: Sequence[float], q: float) -> float:
    """Invert the piecewise-linear histogram CDF at quantile ``q`` (0 < q < 1)."""
    if not 0.0 < q < 1.0:
        raise ValueError("q must be strictly between 0 and 1")
    _validate_histogram(histogram)
    running = 0.0
    for index, weight in enumerate(histogram):
        if running + weight >= q:
            if weight <= 0.0:
                return index * BUCKET_WIDTH
            return index * BUCKET_WIDTH + (q - running) / weight * BUCKET_WIDTH
        running += weight
    return SCALE_MAX


# ---------------------------------------------------------------------------
# Bimodality ("society is at war over this one")
# ---------------------------------------------------------------------------

_MIN_PEAK_SEPARATION_BUCKETS = 4
_PEAK_HEIGHT_RATIO = 0.5
_MAX_DIP_RATIO = 0.7


def detect_bimodality(histogram: Sequence[float]) -> BimodalityReport:
    """Detect two well-separated opinion camps with a genuine dip between them.

    A histogram is bimodal when two smoothed local maxima are at least
    ``_MIN_PEAK_SEPARATION_BUCKETS`` apart, both reach at least
    ``_PEAK_HEIGHT_RATIO`` of the tallest peak, and the valley between them is
    at most ``_MAX_DIP_RATIO`` of the smaller peak.
    """
    _validate_histogram(histogram)
    smoothed = _smooth(histogram)
    peak_indices = _local_maxima(smoothed)
    tallest = max(smoothed)

    strong = [i for i in peak_indices if smoothed[i] >= _PEAK_HEIGHT_RATIO * tallest]
    best: tuple[float, tuple[int, int]] | None = None
    for a_pos, left in enumerate(strong):
        for right in strong[a_pos + 1 :]:
            if right - left < _MIN_PEAK_SEPARATION_BUCKETS:
                continue
            valley = min(smoothed[left : right + 1])
            dip_ratio = valley / min(smoothed[left], smoothed[right])
            if dip_ratio <= _MAX_DIP_RATIO and (best is None or dip_ratio < best[0]):
                best = (dip_ratio, (left, right))

    if best is None:
        return BimodalityReport(is_bimodal=False, peaks=(), dip_ratio=1.0)
    dip_ratio, (left, right) = best
    to_position = lambda i: i * BUCKET_WIDTH + BUCKET_WIDTH / 2  # noqa: E731
    return BimodalityReport(
        is_bimodal=True,
        peaks=(to_position(left), to_position(right)),
        dip_ratio=dip_ratio,
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _validate_guess(guess: Guess) -> None:
    if not 0.0 <= guess.center <= SCALE_MAX:
        raise ValueError(f"center {guess.center} outside the [0, {SCALE_MAX}] scale")
    if guess.width_left < 0.0 or guess.width_right < 0.0:
        raise ValueError("interval widths must be non-negative")


def _validate_histogram(histogram: Sequence[float]) -> None:
    if len(histogram) != N_BUCKETS:
        raise ValueError(f"histogram must have exactly {N_BUCKETS} buckets")
    if any(w < 0.0 for w in histogram):
        raise ValueError("histogram weights must be non-negative")
    if abs(sum(histogram) - 1.0) > 1e-6:
        raise ValueError("histogram must be normalized to sum to 1")


def _covered_fraction(guess: Guess, snapshot: SnapshotStats) -> float:
    low, high = guess.clamped_interval()
    iqr_span = snapshot.q75 - snapshot.q25
    if iqr_span <= 0.0:
        return 1.0 if low <= snapshot.q25 <= high else 0.0
    overlap = min(high, snapshot.q75) - max(low, snapshot.q25)
    return max(0.0, overlap) / iqr_span


def _smooth(histogram: Sequence[float]) -> list[float]:
    smoothed = []
    for i in range(N_BUCKETS):
        window = histogram[max(0, i - 1) : min(N_BUCKETS, i + 2)]
        smoothed.append(sum(window) / len(window))
    return smoothed


def _local_maxima(values: Sequence[float]) -> list[int]:
    """Indices of local maxima; a plateau counts once, at its middle bucket.

    Smoothing an isolated single-bucket spike produces a flat 3-bucket plateau,
    so a strict-inequality scan would miss sharp camps (e.g. everyone answering
    exactly 0 or 100). Plateaus higher than both neighbors are therefore
    treated as one maximum.
    """
    maxima = []
    i = 0
    n = len(values)
    while i < n:
        j = i
        while j + 1 < n and values[j + 1] == values[i]:
            j += 1
        left_ok = i == 0 or values[i] > values[i - 1]
        right_ok = j == n - 1 or values[j] > values[j + 1]
        if left_ok and right_ok:
            maxima.append((i + j) // 2)
        i = j + 1
    return maxima

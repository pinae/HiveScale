"""Research dataset & statistics (WP-13).

The game's real output is a *named-dimension embedding*: every Thing gets a
vector whose dimensions are Scales and whose values are where society places the
Thing on each Scale (the crowd median, 0-100). This module turns the stored
snapshots into that matrix plus the derived statistics researchers care about:

- **scale correlations** — which Scales move together across Things (e.g. does
  "cheap↔expensive" track "tacky↔classy"?);
- **tight vs. wide distributions** — which pairings society agrees on (narrow
  IQR) vs. argues about;
- **"society is at war"** — genuinely bimodal pairings (two opinion camps), via
  :func:`bglib.scoring.detect_bimodality`;
- **AI blind spots** — where the LLM prior diverges most from the human crowd.

Everything here reads only aggregate ``DistributionSnapshot`` rows (computed from
``eligible_guesses`` — flagged, too-fast and zero-weight answers already dropped)
and never touches per-player data, so the output carries no PII by construction.
The only third-party dependency is numpy.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from django.db.models import OuterRef, Subquery

from bglib.scoring import BUCKET_WIDTH, N_BUCKETS, detect_bimodality
from core.models import AIDistribution, ContentStatus, DistributionSnapshot, Pairing

#: Bump when the exported schema changes so downstream consumers can pin it.
DATASET_VERSION = "1.0"

#: A pairing needs at least this many eligible answers before it's trustworthy
#: enough to appear in the research dataset / statistics.
DEFAULT_MIN_N = 15

#: Two scales need this many shared Things before a correlation is reported.
DEFAULT_MIN_OVERLAP = 3

#: Bucket centres on the 0-100 scale, used for histogram mean/std.
_BUCKET_CENTERS = np.array([(i + 0.5) * BUCKET_WIDTH for i in range(N_BUCKETS)])


# ---------------------------------------------------------------------------
# Per-pairing rows
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PairingRow:
    """One graduated pairing's crowd distribution plus its derived shape stats."""

    pairing_id: int
    thing_id: int
    thing: str
    scale_id: int
    scale_left: str
    scale_right: str
    n: int
    median: float
    q25: float
    q75: float
    iqr: float
    std: float
    is_bimodal: bool
    dip_ratio: float
    peaks: tuple[float, ...]
    histogram: list[float]
    ai_model: str | None
    ai_median: float | None
    ai_median_divergence: float | None
    ai_tv_distance: float | None
    ai_histogram: list[float] | None

    @property
    def scale_label(self) -> str:
        return f"{self.scale_left} ↔ {self.scale_right}"

    @property
    def shape(self) -> str:
        """A one-word classification used in the admin and the export."""
        if self.is_bimodal:
            return "divided"
        if self.iqr <= 12.0:
            return "tight"
        if self.iqr >= 30.0:
            return "wide"
        return "normal"


def _histogram_std(histogram: list[float]) -> float:
    """Standard deviation (on the 0-100 scale) of a normalized histogram."""
    weights = np.asarray(histogram, dtype=float)
    total = weights.sum()
    if total <= 0:
        return 0.0
    weights = weights / total
    mean = float((weights * _BUCKET_CENTERS).sum())
    variance = float((weights * (_BUCKET_CENTERS - mean) ** 2).sum())
    return math.sqrt(max(0.0, variance))


def _total_variation(a: list[float], b: list[float]) -> float:
    """Total-variation distance between two normalized histograms (0..1)."""
    va, vb = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    return float(0.5 * np.abs(va - vb).sum())


def _latest_ai_by_pairing() -> dict[int, AIDistribution]:
    """The most recent AI estimate per pairing (any model), for divergence."""
    newest = (
        AIDistribution.objects.filter(pairing=OuterRef("pk"))
        .order_by("-created_at", "-id")
        .values("id")[:1]
    )
    ai_ids = (
        Pairing.objects.annotate(ai_id=Subquery(newest))
        .values_list("ai_id", flat=True)
    )
    rows = AIDistribution.objects.filter(id__in=[i for i in ai_ids if i is not None])
    return {ai.pairing_id: ai for ai in rows}


def pairing_rows(min_n: int = DEFAULT_MIN_N) -> list[PairingRow]:
    """Every active pairing whose latest snapshot has ``>= min_n`` answers.

    One row per pairing, ordered by (thing, scale) so the output is stable.
    """
    latest = (
        DistributionSnapshot.objects.filter(pairing=OuterRef("pk"))
        .order_by("-computed_at", "-id")
        .values("id")[:1]
    )
    pairings = (
        Pairing.objects.filter(
            status=ContentStatus.ACTIVE,
            thing__status=ContentStatus.ACTIVE,
            scale__status=ContentStatus.ACTIVE,
        )
        .annotate(snap_id=Subquery(latest))
        .select_related("thing", "scale")
    )
    snap_ids = [p.snap_id for p in pairings if p.snap_id is not None]
    snapshots = {
        s.id: s for s in DistributionSnapshot.objects.filter(id__in=snap_ids)
    }
    ai_by_pairing = _latest_ai_by_pairing()

    rows: list[PairingRow] = []
    for pairing in pairings:
        snap = snapshots.get(pairing.snap_id) if pairing.snap_id else None
        if snap is None or snap.n < min_n:
            continue
        histogram = [float(x) for x in snap.histogram]
        report = detect_bimodality(histogram)

        ai = ai_by_pairing.get(pairing.pk)
        ai_median = ai_div = ai_tv = ai_hist = None
        ai_model = None
        if ai is not None:
            ai_model = ai.model_name
            ai_median = float(ai.median)
            ai_hist = [float(x) for x in ai.histogram]
            ai_div = abs(ai_median - float(snap.median))
            ai_tv = _total_variation(histogram, ai_hist)

        rows.append(
            PairingRow(
                pairing_id=pairing.pk,
                thing_id=pairing.thing_id,
                thing=pairing.thing.text,
                scale_id=pairing.scale_id,
                scale_left=pairing.scale.left_label,
                scale_right=pairing.scale.right_label,
                n=snap.n,
                median=float(snap.median),
                q25=float(snap.q25),
                q75=float(snap.q75),
                iqr=float(snap.q75) - float(snap.q25),
                std=_histogram_std(histogram),
                is_bimodal=report.is_bimodal,
                dip_ratio=report.dip_ratio,
                peaks=report.peaks,
                histogram=histogram,
                ai_model=ai_model,
                ai_median=ai_median,
                ai_median_divergence=ai_div,
                ai_tv_distance=ai_tv,
                ai_histogram=ai_hist,
            )
        )
    rows.sort(key=lambda r: (r.thing.lower(), r.scale_label.lower()))
    return rows


# ---------------------------------------------------------------------------
# The named-dimension embedding matrix
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EmbeddingMatrix:
    """Things × Scales crowd-median matrix (``nan`` where a pairing is missing)."""

    thing_ids: list[int]
    thing_labels: list[str]
    scale_ids: list[int]
    scale_labels: list[str]
    values: np.ndarray  # shape (n_things, n_scales); nan = no data


def embedding_matrix(rows: list[PairingRow]) -> EmbeddingMatrix:
    """Pivot pairing rows into the Thing×Scale median matrix (the embedding)."""
    thing_order: dict[int, str] = {}
    scale_order: dict[int, str] = {}
    for row in rows:
        thing_order.setdefault(row.thing_id, row.thing)
        scale_order.setdefault(row.scale_id, row.scale_label)

    thing_ids = sorted(thing_order, key=lambda i: thing_order[i].lower())
    scale_ids = sorted(scale_order, key=lambda i: scale_order[i].lower())
    thing_index = {tid: i for i, tid in enumerate(thing_ids)}
    scale_index = {sid: j for j, sid in enumerate(scale_ids)}

    values = np.full((len(thing_ids), len(scale_ids)), np.nan)
    for row in rows:
        values[thing_index[row.thing_id], scale_index[row.scale_id]] = row.median

    return EmbeddingMatrix(
        thing_ids=thing_ids,
        thing_labels=[thing_order[i] for i in thing_ids],
        scale_ids=scale_ids,
        scale_labels=[scale_order[i] for i in scale_ids],
        values=values,
    )


# ---------------------------------------------------------------------------
# Scale correlations
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ScaleCorrelation:
    scale_a: str
    scale_b: str
    r: float
    n_overlap: int


def correlation_matrix(
    matrix: EmbeddingMatrix, min_overlap: int = DEFAULT_MIN_OVERLAP
) -> tuple[np.ndarray, np.ndarray]:
    """Pairwise Pearson r between scales over Things rated on both.

    Returns ``(corr, overlap)`` square arrays of side ``len(scale_ids)``; entries
    with fewer than ``min_overlap`` shared Things are ``nan`` (undefined).
    """
    data = matrix.values
    n_scales = data.shape[1]
    corr = np.full((n_scales, n_scales), np.nan)
    overlap = np.zeros((n_scales, n_scales), dtype=int)

    for i in range(n_scales):
        for j in range(i, n_scales):
            mask = ~np.isnan(data[:, i]) & ~np.isnan(data[:, j])
            k = int(mask.sum())
            overlap[i, j] = overlap[j, i] = k
            if i == j:
                corr[i, j] = 1.0 if k > 0 else np.nan
                continue
            if k < min_overlap:
                continue
            xi, xj = data[mask, i], data[mask, j]
            if xi.std() == 0 or xj.std() == 0:
                continue  # a flat column has no defined correlation
            r = float(np.corrcoef(xi, xj)[0, 1])
            corr[i, j] = corr[j, i] = r
    return corr, overlap


def top_scale_correlations(
    matrix: EmbeddingMatrix, min_overlap: int = DEFAULT_MIN_OVERLAP, limit: int = 20
) -> list[ScaleCorrelation]:
    """Scale pairs ranked by absolute correlation (strongest links first)."""
    corr, overlap = correlation_matrix(matrix, min_overlap)
    out: list[ScaleCorrelation] = []
    for i in range(len(matrix.scale_labels)):
        for j in range(i + 1, len(matrix.scale_labels)):
            r = corr[i, j]
            if np.isnan(r):
                continue
            out.append(
                ScaleCorrelation(
                    scale_a=matrix.scale_labels[i],
                    scale_b=matrix.scale_labels[j],
                    r=r,
                    n_overlap=int(overlap[i, j]),
                )
            )
    out.sort(key=lambda c: abs(c.r), reverse=True)
    return out[:limit]


# ---------------------------------------------------------------------------
# Highlight lists for the admin dashboard
# ---------------------------------------------------------------------------


def tightest_pairings(rows: list[PairingRow], limit: int = 15) -> list[PairingRow]:
    """Pairings society most agrees on (narrowest IQR), unimodal only."""
    agreed = [r for r in rows if not r.is_bimodal]
    return sorted(agreed, key=lambda r: (r.iqr, r.std))[:limit]


def most_divided_pairings(rows: list[PairingRow], limit: int = 15) -> list[PairingRow]:
    """"Society is at war": bimodal pairings, deepest valley (lowest dip) first."""
    divided = [r for r in rows if r.is_bimodal]
    return sorted(divided, key=lambda r: r.dip_ratio)[:limit]


def top_ai_divergences(rows: list[PairingRow], limit: int = 15) -> list[PairingRow]:
    """AI blind spots: where the LLM prior's median is furthest from the crowd."""
    scored = [r for r in rows if r.ai_median_divergence is not None]
    return sorted(scored, key=lambda r: r.ai_median_divergence, reverse=True)[:limit]

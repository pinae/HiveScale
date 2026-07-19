"""Domain services (WP-03): snapshot recomputation.

Pure orchestration over ``bglib.scoring`` — all math lives in the library.
"""

from django.db import transaction
from django.utils import timezone

from bglib.scoring import build_histogram, weighted_quantile
from core.models import DistributionSnapshot, Pairing

#: Answers submitted faster than this are stored but never enter the baseline
#: (plan §1.7 — speed floor).
SPEED_FLOOR_MS = 1500

#: Eligible human answers required before a pairing "graduates" and scoring
#: switches from the AI provisional estimate to the human baseline (plan §1.5).
N_MIN_GRADUATION = 15


def eligible_guesses(pairing: Pairing):
    """Guesses that count toward the human baseline.

    Excluded: quality-flagged answers, answers under the speed floor, and
    answers from silently zero-weighted players. ``AIDistribution`` rows can
    never appear here — they live in a different table entirely, by design.
    """
    return pairing.guesses.filter(
        quality_flags=[],
        response_ms__gte=SPEED_FLOOR_MS,
        player__weight__gt=0.0,
    ).select_related("player")


@transaction.atomic
def recompute_snapshot(pairing: Pairing) -> DistributionSnapshot:
    """Recompute the crowd baseline for a pairing and update its bookkeeping.

    Raises ``ValueError`` if the pairing has no eligible guesses yet. Also
    maintains ``pairing.n_answers`` and stamps ``graduated_at`` (permanently)
    once ``N_MIN_GRADUATION`` eligible answers exist.
    """
    rows = list(eligible_guesses(pairing).values_list("center", "player__weight"))
    if not rows:
        raise ValueError(f"pairing {pairing.pk} has no eligible guesses to snapshot")

    centers = [center for center, _ in rows]
    weights = [weight for _, weight in rows]

    snapshot = DistributionSnapshot.objects.create(
        pairing=pairing,
        histogram=list(build_histogram(centers, weights)),
        median=weighted_quantile(centers, weights, 0.5),
        q25=weighted_quantile(centers, weights, 0.25),
        q75=weighted_quantile(centers, weights, 0.75),
        n=len(rows),
    )

    pairing.n_answers = len(rows)
    if pairing.graduated_at is None and pairing.n_answers >= N_MIN_GRADUATION:
        pairing.graduated_at = timezone.now()
    pairing.save(update_fields=["n_answers", "graduated_at"])
    return snapshot

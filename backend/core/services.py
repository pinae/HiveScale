"""Domain services (WP-03): snapshot recomputation.

Pure orchestration over ``bglib.scoring`` — all math lives in the library.
"""

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from bglib.scoring import N_BUCKETS, build_histogram, split_normal_histogram, weighted_quantile
from core.models import DistributionSnapshot, Pairing, Player

#: Answers submitted faster than this are stored but never enter the baseline
#: (plan §1.7 — speed floor).
SPEED_FLOOR_MS = 1500

#: Eligible human answers required before a pairing "graduates" and scoring
#: switches from the AI provisional estimate to the human baseline (plan §1.5).
#: Defaults to 15; lower it (e.g. to 3) via GRADUATION_MIN_ANSWERS in dev to reach
#: a human baseline — and the animated crowd histogram — in just a few rounds.
N_MIN_GRADUATION = getattr(settings, "GRADUATION_MIN_ANSWERS", 15)


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
    rows = list(
        eligible_guesses(pairing).values_list(
            "center", "width_left", "width_right", "player__weight"
        )
    )
    if not rows:
        raise ValueError(f"pairing {pairing.pk} has no eligible guesses to snapshot")

    centers = [center for center, _, _, _ in rows]
    weights = [weight for _, _, _, weight in rows]

    snapshot = DistributionSnapshot.objects.create(
        pairing=pairing,
        histogram=list(build_histogram(centers, weights)),
        belief_histogram=_belief_histogram(rows),
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


def _belief_histogram(rows: list[tuple[float, float, float, float]]) -> list[float]:
    """Weighted average of every eligible guess's split-normal, as a normalized
    ``N_BUCKETS`` histogram — the crowd's *summed beliefs* (the reveal's curve)."""
    belief = [0.0] * N_BUCKETS
    total_weight = 0.0
    for center, width_left, width_right, weight in rows:
        guess_hist = split_normal_histogram(center, width_left, width_right)
        for i, mass in enumerate(guess_hist):
            belief[i] += weight * mass
        total_weight += weight
    if total_weight <= 0:
        return []
    return [b / total_weight for b in belief]


def backfill_missing_belief_histograms() -> int:
    """Fill in ``belief_histogram`` on each pairing's latest snapshot where it's
    empty (snapshots computed before the field existed).

    The reveal scores against a pairing's latest snapshot, so a stale one makes
    the belief curve vanish and collapses ``belief_match`` onto ``means_match``.
    Recomputes belief from the pairing's current eligible guesses — which, since
    snapshots are refreshed on every counted answer, are exactly that snapshot's
    basis. Returns the number of snapshots updated. Idempotent.
    """
    updated = 0
    for pairing in Pairing.objects.all():
        snapshot = pairing.snapshots.order_by("-computed_at", "-id").first()
        if snapshot is None or snapshot.belief_histogram:
            continue
        rows = list(
            eligible_guesses(pairing).values_list(
                "center", "width_left", "width_right", "player__weight"
            )
        )
        belief = _belief_histogram(rows)
        if belief:
            snapshot.belief_histogram = belief
            snapshot.save(update_fields=["belief_histogram"])
            updated += 1
    return updated


# ---------------------------------------------------------------------------
# Account claiming (WP-04)
# ---------------------------------------------------------------------------


def merge_players(source, target) -> None:
    """Fold ``source``'s history into ``target`` and delete ``source``.

    Guesses (with their RoundScores riding along via FK) move over, xp is
    additive, level keeps the best, and calibration stats — being additive
    counters — merge exactly.
    """
    source.guesses.update(player=target)
    target.xp += source.xp
    target.level = max(target.level, source.level)
    merged_stats = dict(target.calibration_stats or {})
    for key, value in (source.calibration_stats or {}).items():
        merged_stats[key] = merged_stats.get(key, 0) + value
    target.calibration_stats = merged_stats
    target.save(update_fields=["xp", "level", "calibration_stats"])
    source.delete()


@transaction.atomic
def claim_player(player, email: str) -> tuple[Player, bool]:
    """Attach ``player`` to the account for ``email``, merging if it exists.

    Returns ``(resulting_player, merged)``. Either way the anonymous device
    token stops working afterwards: on a first claim the token is rotated, on
    a merge the anonymous player row is deleted outright.
    """
    from django.contrib.auth import get_user_model

    from core.sessions import rotate_device_token

    email = email.strip().lower()
    user, _ = get_user_model().objects.get_or_create(
        username=email, defaults={"email": email}
    )
    existing = Player.objects.filter(user=user).exclude(pk=player.pk).first()
    if existing is None:
        player.user = user
        player.save(update_fields=["user"])
        rotate_device_token(player)
        return player, False
    merge_players(source=player, target=existing)
    return existing, True

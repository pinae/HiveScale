"""Backfill ``belief_histogram`` on snapshots created before the field existed.

Self-contained (uses the historical models via ``apps``) so it stays correct
regardless of later code changes; the runtime path lives in
``core.services.backfill_missing_belief_histograms``.
"""

from django.db import migrations

from bglib.scoring import N_BUCKETS, split_normal_histogram

#: Mirrors ``core.services.SPEED_FLOOR_MS`` — answers faster than this never
#: enter the baseline, so they're excluded from the belief aggregate too.
SPEED_FLOOR_MS = 1500


def _belief(rows) -> list[float]:
    belief = [0.0] * N_BUCKETS
    total = 0.0
    for center, width_left, width_right, weight in rows:
        for i, mass in enumerate(split_normal_histogram(center, width_left, width_right)):
            belief[i] += weight * mass
        total += weight
    return [b / total for b in belief] if total > 0 else []


def backfill(apps, schema_editor):
    Pairing = apps.get_model("core", "Pairing")
    Snapshot = apps.get_model("core", "DistributionSnapshot")
    Guess = apps.get_model("core", "Guess")
    for pairing_id in Pairing.objects.values_list("id", flat=True):
        snapshot = (
            Snapshot.objects.filter(pairing_id=pairing_id)
            .order_by("-computed_at", "-id")
            .first()
        )
        if snapshot is None or snapshot.belief_histogram:
            continue
        rows = Guess.objects.filter(
            pairing_id=pairing_id,
            quality_flags=[],
            response_ms__gte=SPEED_FLOOR_MS,
            player__weight__gt=0.0,
        ).values_list("center", "width_left", "width_right", "player__weight")
        belief = _belief(list(rows))
        if belief:
            snapshot.belief_histogram = belief
            snapshot.save(update_fields=["belief_histogram"])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [("core", "0010_distributionsnapshot_belief_histogram")]
    operations = [migrations.RunPython(backfill, noop)]

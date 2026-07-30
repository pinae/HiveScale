"""``manage.py pair_all`` — create every missing Thing × Scale pairing.

Idempotent: existing pairings are left exactly as they are (status, answer
counts, votes, ``voting_disabled``), and only the missing combinations of
*active* things and *active* scales are created — as ACTIVE with voting enabled,
so the crowd can vote the duds back out.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import ContentStatus, Pairing, Scale, Thing


class Command(BaseCommand):
    help = "Create every missing (active Thing) × (active Scale) pairing, with voting enabled."

    @transaction.atomic
    def handle(self, *args, **options):
        thing_ids = list(
            Thing.objects.filter(status=ContentStatus.ACTIVE).values_list("id", flat=True)
        )
        scale_ids = list(
            Scale.objects.filter(status=ContentStatus.ACTIVE).values_list("id", flat=True)
        )
        existing = set(Pairing.objects.values_list("thing_id", "scale_id"))

        to_create = [
            Pairing(
                thing_id=thing_id,
                scale_id=scale_id,
                status=ContentStatus.ACTIVE,
                voting_disabled=False,
            )
            for thing_id in thing_ids
            for scale_id in scale_ids
            if (thing_id, scale_id) not in existing
        ]
        # ignore_conflicts guards the unique (thing, scale) constraint against a
        # concurrent run; the pre-filter means this only ever skips real dupes.
        Pairing.objects.bulk_create(to_create, ignore_conflicts=True)

        possible = len(thing_ids) * len(scale_ids)
        self.stdout.write(
            self.style.SUCCESS(
                f"{len(thing_ids)} active things × {len(scale_ids)} active scales = "
                f"{possible} possible pairings; created {len(to_create)} new, "
                f"kept {len(existing)} existing."
            )
        )

"""``manage.py backfill_beliefs`` — fill missing snapshot belief histograms.

The 0011 data migration does this once on deploy; this command is the manual,
re-runnable equivalent (e.g. after importing snapshots from elsewhere). Idempotent.
"""

from django.core.management.base import BaseCommand

from core.services import backfill_missing_belief_histograms


class Command(BaseCommand):
    help = "Recompute belief_histogram on any snapshot that's missing it."

    def handle(self, *args, **options):
        updated = backfill_missing_belief_histograms()
        self.stdout.write(
            self.style.SUCCESS(f"Backfilled belief_histogram on {updated} snapshot(s).")
        )

"""Generate the Daily Wave for a date (defaults to today). Idempotent."""

import datetime

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from core.daily_wave import WAVE_SIZE, generate_daily_wave


class Command(BaseCommand):
    help = "Generate the shared Daily Wave for a date (defaults to today)."

    def add_arguments(self, parser):
        parser.add_argument("--date", help="ISO date (YYYY-MM-DD); defaults to today.")
        parser.add_argument("--size", type=int, default=WAVE_SIZE)

    def handle(self, *args, **options):
        if options["date"]:
            try:
                day = datetime.date.fromisoformat(options["date"])
            except ValueError as exc:
                raise CommandError(f"invalid --date: {exc}") from exc
        else:
            day = timezone.localdate()

        try:
            wave = generate_daily_wave(day, size=options["size"])
        except ValueError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            self.style.SUCCESS(f"Daily Wave {day}: {len(wave.pairing_ids)} pairings")
        )

"""``manage.py seed_demo`` — deterministic demo dataset (WP-03 acceptance).

Creates 20 Things, 10 Scales, 60 pairings, 30 players, and plausible synthetic
guesses (including a sprinkle of too-fast flagged answers, so the exclusion
path is visible in dev), then computes snapshots. Fully deterministic from a
fixed seed so demo databases are reproducible.
"""

import random

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.text import slugify

from core.models import (
    AIDistribution,
    DailyWave,
    DistributionSnapshot,
    Guess,
    Pairing,
    Player,
    RoundScore,
    Scale,
    Thing,
)
from core.services import SPEED_FLOOR_MS, recompute_snapshot

SEED = 20260719

THINGS = [
    "Robotic lawnmower", "Pineapple pizza", "Cryptocurrency", "Standing desk",
    "Karaoke night", "Electric scooter", "Sourdough starter", "Open-plan office",
    "Self-checkout kiosk", "Smart fridge", "Reply-all email", "Escape room",
    "Fax machine", "Cold shower", "Group chat", "Loyalty card app",
    "Airport lounge", "Monday morning meeting", "Voice assistant", "Paper map",
]

SCALES = [
    ("sophisticated", "overly complicated"),
    ("delightful", "disgusting"),
    ("underrated", "overrated"),
    ("relaxing", "stressful"),
    ("timeless", "obsolete"),
    ("trustworthy", "sketchy"),
    ("necessary", "pointless"),
    ("cheap thrill", "luxury"),
    ("introvert heaven", "extrovert heaven"),
    ("saves time", "wastes time"),
]

N_PAIRINGS = 60
N_PLAYERS = 30


class Command(BaseCommand):
    help = "Seed a deterministic demo dataset (20 things, 10 scales, 60 pairings)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete ALL existing game data first (dev databases only!).",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        has_data = Thing.objects.exists() or Player.objects.exists()
        if has_data and not options["reset"]:
            raise CommandError("Database already contains data; re-run with --reset to replace it.")
        if options["reset"]:
            for model in (
                RoundScore, Guess, DistributionSnapshot, AIDistribution,
                DailyWave, Pairing, Thing, Scale, Player,
            ):
                model.objects.all().delete()

        rng = random.Random(SEED)

        players = Player.objects.bulk_create(
            Player(device_token=f"seed-player-{i:02d}") for i in range(N_PLAYERS)
        )
        things = Thing.objects.bulk_create(
            Thing(text=text, slug=slugify(text)) for text in THINGS
        )
        scales = Scale.objects.bulk_create(
            Scale(left_label=left, right_label=right, slug=slugify(f"{left}-{right}"))
            for left, right in SCALES
        )

        combos = [(t, s) for t in things for s in scales]
        pairings = Pairing.objects.bulk_create(
            Pairing(thing=t, scale=s) for t, s in rng.sample(combos, N_PAIRINGS)
        )

        total_guesses = 0
        for pairing in pairings:
            true_center = rng.uniform(8, 92)
            spread = rng.uniform(4, 18)
            batch = []
            for _ in range(rng.randint(8, 40)):
                center = min(100.0, max(0.0, rng.gauss(true_center, spread)))
                too_fast = rng.random() < 0.05
                batch.append(
                    Guess(
                        pairing=pairing,
                        player=rng.choice(players),
                        center=round(center, 2),
                        width_left=round(rng.uniform(3, 25), 2),
                        width_right=round(rng.uniform(3, 25), 2),
                        response_ms=(
                            rng.randint(400, SPEED_FLOOR_MS - 1)
                            if too_fast
                            else rng.randint(SPEED_FLOOR_MS + 100, 12000)
                        ),
                        quality_flags=["too_fast"] if too_fast else [],
                    )
                )
            Guess.objects.bulk_create(batch)
            total_guesses += len(batch)
            try:
                recompute_snapshot(pairing)
            except ValueError:
                pass  # every answer happened to be flagged; pairing stays fresh

        graduated = Pairing.objects.filter(graduated_at__isnull=False).count()
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {len(things)} things, {len(scales)} scales, "
                f"{len(pairings)} pairings, {N_PLAYERS} players, "
                f"{total_guesses} guesses ({graduated} pairings graduated)."
            )
        )

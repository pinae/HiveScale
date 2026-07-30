"""``manage.py backfill_ai_estimates`` — request an AI estimate for every pairing.

The per-pairing cold start only fires the first time a *fresh* pairing is dealt.
After a bulk import (e.g. ``pair_all``) you usually want AI estimates for the
whole pool up front — this enqueues one Gemini task per pairing that doesn't yet
have an estimate for the current model + prompt version.

It only *enqueues* work; the Celery worker does the calls, at its own pace
(bounded by its ``--concurrency`` and the per-task retry/backoff), so the API
account isn't hammered. Requires the worker, Redis, and ``GEMINI_API_KEY`` to be
running/set; without a reachable broker it stops early rather than spin.
"""

from django.conf import settings
from django.core.management.base import BaseCommand

from core.ai import PROMPT_VERSION
from core.models import AIDistribution, ContentStatus, Pairing
from core.tasks import _enqueue_fast, estimate_distribution


class Command(BaseCommand):
    help = "Enqueue a Gemini estimate for every pairing that doesn't have one yet."

    def add_arguments(self, parser):
        parser.add_argument(
            "--all-statuses",
            action="store_true",
            help="Include non-active pairings (default: active only).",
        )

    def handle(self, *args, **options):
        model = settings.GEMINI_MODEL
        have = set(
            AIDistribution.objects.filter(
                model_name=model, prompt_version=PROMPT_VERSION
            ).values_list("pairing_id", flat=True)
        )
        pairings = Pairing.objects.all()
        if not options["all_statuses"]:
            pairings = pairings.filter(status=ContentStatus.ACTIVE)

        pending = [pid for pid in pairings.values_list("id", flat=True) if pid not in have]

        enqueued = 0
        for pairing_id in pending:
            try:
                _enqueue_fast(estimate_distribution, (pairing_id,))
            except Exception as exc:  # broker unreachable — don't spin on every row
                self.stderr.write(
                    self.style.ERROR(
                        f"Stopped after {enqueued}: could not reach the broker ({exc}). "
                        "Is Redis up and the celery worker running?"
                    )
                )
                return
            enqueued += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Enqueued {enqueued} AI-estimate task(s) for model {model!r}; "
                f"{len(have)} pairing(s) already had one."
            )
        )

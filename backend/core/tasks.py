"""Celery tasks and their request-side triggers (WP-07)."""

import logging

from celery import shared_task

from core.models import Pairing

logger = logging.getLogger(__name__)


@shared_task(name="core.estimate_distribution")
def estimate_distribution(pairing_id: int) -> int | None:
    """Cold-start worker: store an AI distribution estimate for a pairing.

    Returns the ``AIDistribution`` pk on success, or ``None`` when the pairing
    is gone or the model never produced a valid estimate (pioneer fallback).
    """
    from core.ai import generate_ai_distribution, get_gemini_client

    pairing = Pairing.objects.filter(pk=pairing_id).select_related("thing", "scale").first()
    if pairing is None:
        return None
    result = generate_ai_distribution(pairing, get_gemini_client())
    return result.pk if result is not None else None


def schedule_cold_start(pairing: Pairing) -> bool:
    """Best-effort enqueue of a cold-start estimate for a *fresh* pairing.

    Only fires for pairings with no answers and no existing estimate, and never
    raises into the request path — if the broker is unreachable the round still
    plays as a plain pioneer round (plan §3.1). Returns whether it enqueued.
    """
    if pairing.n_answers > 0 or pairing.graduated or pairing.ai_distributions.exists():
        return False
    try:
        estimate_distribution.delay(pairing.pk)
        return True
    except Exception as exc:  # broker down, misconfig — pioneer mode still works
        logger.warning("could not enqueue cold start for pairing %s: %s", pairing.pk, exc)
        return False

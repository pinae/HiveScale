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


@shared_task(name="core.sanity_check_thing")
def sanity_check_thing(thing_id: int) -> str | None:
    """Vet a submitted Thing with the LLM and update its status (WP-11)."""
    from core.ai import get_gemini_client
    from core.content import run_sanity_check
    from core.models import Thing

    obj = Thing.objects.filter(pk=thing_id).first()
    return None if obj is None else run_sanity_check(obj, get_gemini_client())


@shared_task(name="core.sanity_check_scale")
def sanity_check_scale(scale_id: int) -> str | None:
    """Vet a submitted Scale with the LLM and update its status (WP-11)."""
    from core.ai import get_gemini_client
    from core.content import run_sanity_check
    from core.models import Scale

    obj = Scale.objects.filter(pk=scale_id).first()
    return None if obj is None else run_sanity_check(obj, get_gemini_client())


def schedule_sanity_check(kind: str, obj_id: int) -> bool:
    """Best-effort enqueue of a content sanity check; never breaks the request."""
    task = sanity_check_thing if kind == "thing" else sanity_check_scale
    try:
        task.delay(obj_id)
        return True
    except Exception as exc:  # broker down — the item just waits in the queue
        logger.warning("could not enqueue sanity check for %s %s: %s", kind, obj_id, exc)
        return False

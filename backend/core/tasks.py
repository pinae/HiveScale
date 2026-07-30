"""Celery tasks and their request-side triggers (WP-07)."""

import logging

from celery import shared_task

from core.models import Pairing

logger = logging.getLogger(__name__)


def _enqueue_fast(task, args: tuple) -> None:
    """Publish a task with a single, short broker-connection attempt.

    The cold-start and sanity-check enqueues run in the request path and are
    best-effort, so a dead/absent broker must fail in milliseconds rather than
    block the request while celery retries the connection.
    """
    from config.celery import app

    with app.connection_for_write(connect_timeout=2) as conn:
        conn.ensure_connection(max_retries=0)
        task.apply_async(args, connection=conn, retry=False)


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
        _enqueue_fast(estimate_distribution, (pairing.pk,))
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
        _enqueue_fast(task, (obj_id,))
        return True
    except Exception as exc:  # broker down — the item just waits in the queue
        logger.warning("could not enqueue sanity check for %s %s: %s", kind, obj_id, exc)
        return False

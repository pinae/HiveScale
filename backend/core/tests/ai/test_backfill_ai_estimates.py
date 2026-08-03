"""`manage.py backfill_ai_estimates`: enqueue estimates for pairings missing one."""

import pytest
from django.core.management import call_command

from core import tasks
from core.ai import PROMPT_VERSION
from core.models import AIDistribution, ContentStatus, Pairing, Scale, Thing

pytestmark = pytest.mark.django_db


def _pairing(i: int, status: str = ContentStatus.ACTIVE) -> Pairing:
    thing = Thing.objects.create(text=f"Thing {i}", slug=f"thing-{i}")
    scale = Scale.objects.create(left_label=f"l{i}", right_label=f"r{i}", slug=f"scale-{i}")
    return Pairing.objects.create(thing=thing, scale=scale, status=status)


def _capture_enqueued(monkeypatch) -> list[int]:
    enqueued: list[int] = []
    monkeypatch.setattr(tasks, "_enqueue_fast", lambda task, args: enqueued.append(args[0]))
    # The command imports the symbol directly, so patch it there too.
    monkeypatch.setattr(
        "core.management.commands.backfill_ai_estimates._enqueue_fast",
        lambda task, args: enqueued.append(args[0]),
    )
    return enqueued


def test_enqueues_active_pairings_without_an_estimate(monkeypatch, settings) -> None:
    enqueued = _capture_enqueued(monkeypatch)
    a, b = _pairing(0), _pairing(1)
    # b already has an estimate for the configured model → skipped.
    AIDistribution.objects.create(
        pairing=b, model_name=settings.GEMINI_MODEL, prompt_version=PROMPT_VERSION,
        histogram=[0.05] * 20, median=50, q25=40, q75=60,
    )

    call_command("backfill_ai_estimates")

    assert enqueued == [a.pk]


def test_skips_non_active_pairings_unless_all_statuses(monkeypatch) -> None:
    active = _pairing(0)
    draft = _pairing(1, status=ContentStatus.DRAFT)

    enqueued = _capture_enqueued(monkeypatch)
    call_command("backfill_ai_estimates")
    assert enqueued == [active.pk]

    enqueued.clear()
    call_command("backfill_ai_estimates", "--all-statuses")
    assert set(enqueued) == {active.pk, draft.pk}


def test_limit_caps_how_many_are_enqueued_per_run(monkeypatch) -> None:
    pairings = [_pairing(i) for i in range(5)]
    enqueued = _capture_enqueued(monkeypatch)

    call_command("backfill_ai_estimates", "--limit", "2")

    # Only the first two of the five pending pairings are enqueued this run.
    assert enqueued == [pairings[0].pk, pairings[1].pk]


def test_limit_zero_lifts_the_cap(monkeypatch, settings) -> None:
    settings.GEMINI_BACKFILL_LIMIT = 2  # would cap at 2 by default
    pairings = [_pairing(i) for i in range(4)]
    enqueued = _capture_enqueued(monkeypatch)

    call_command("backfill_ai_estimates", "--limit", "0")

    assert set(enqueued) == {p.pk for p in pairings}

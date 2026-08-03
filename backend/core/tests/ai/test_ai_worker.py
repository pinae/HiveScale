"""The Gemini cold-start worker.

Executable spec (docs/hivescale-plan.md, WP-07 + §1.5/§3.1):
- ``generate_ai_distribution(pairing, client)`` asks a Gemini-shaped client for
  a distribution estimate, validates it against a JSON schema, and stores an
  ``AIDistribution`` versioned by model name and prompt version;
- malformed or failing responses are retried with backoff (injected clock) and,
  once attempts are exhausted, fall back to pure pioneer mode (no row written);
- the worker is idempotent per pairing (the unique estimate is never rebuilt);
- an ``AIDistribution`` can never leak into the human baseline / snapshot query;
- the Celery task ``estimate_distribution(pairing_id)`` wraps the service, and a
  fresh pairing dealt by ``/api/round/next/`` schedules the cold start.

All tests use ``FakeGeminiClient``; one ``@external`` smoke test (excluded from
CI) hits the real API.
"""

import json

import pytest
from rest_framework.test import APIClient

from core import ai
from core.ai import (
    PROMPT_VERSION,
    FakeGeminiClient,
    build_prompt,
    generate_ai_distribution,
    parse_response,
)
from core.models import AIDistribution, Guess, Pairing, Player, Scale, Thing
from core.services import eligible_guesses, recompute_snapshot

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _reset_ai_cooldown():
    """Rate-limit cooldown is process-wide module state; isolate it per test."""
    ai.reset_cooldown()
    yield
    ai.reset_cooldown()


# Realistic 429 bodies (google-genai stringifies the error dict like this).
_DAILY_429 = (
    "429 RESOURCE_EXHAUSTED. {'error': {'code': 429, 'message': 'quota exceeded', "
    "'status': 'RESOURCE_EXHAUSTED', 'details': [{'quotaId': "
    "'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}, {'retryDelay': '29s'}]}}"
)
_PER_MINUTE_429 = (
    "429 RESOURCE_EXHAUSTED. {'error': {'code': 429, 'message': 'rate limit', "
    "'status': 'RESOURCE_EXHAUSTED', 'details': [{'quotaId': "
    "'GenerateRequestsPerMinutePerProjectPerModel-FreeTier'}, {'retryDelay': '29s'}]}}"
)


# --- Fixtures ---------------------------------------------------------------


def _make_pairing(index: int = 1) -> Pairing:
    thing = Thing.objects.create(text=f"Thing {index}", slug=f"thing-{index}")
    scale = Scale.objects.create(
        left_label=f"left {index}", right_label=f"right {index}", slug=f"scale-{index}"
    )
    return Pairing.objects.create(thing=thing, scale=scale)


def _graduated_pairing() -> Pairing:
    pairing = _make_pairing()
    crowd = Player.objects.create(device_token="tok-crowd")
    for center in [40, 45, 48, 50, 50, 50, 52, 55, 60, 47, 53, 49, 51, 46, 54]:
        Guess.objects.create(
            pairing=pairing, player=crowd, center=float(center),
            width_left=8, width_right=8, response_ms=4000,
        )
    recompute_snapshot(pairing)
    return pairing


def _session(client: APIClient) -> Player:
    assert client.post("/api/session/").status_code == 200
    return Player.objects.latest("created_at")


def _valid_payload(median: float = 55.0) -> dict:
    histogram = [0.0] * 20
    histogram[10] = 0.5
    histogram[11] = 0.5
    return {
        "median": median,
        "q25": 45.0,
        "q75": 65.0,
        "histogram": histogram,
        "rationale": "canned rationale",
    }


def _valid_response(median: float = 55.0) -> str:
    return json.dumps(_valid_payload(median))


# --- Happy path -------------------------------------------------------------


def test_valid_response_creates_a_versioned_ai_distribution() -> None:
    pairing = _make_pairing()
    client = FakeGeminiClient([_valid_response(median=57.0)])

    ai = generate_ai_distribution(pairing, client)

    assert ai is not None
    assert ai.pairing_id == pairing.pk
    assert ai.model_name == client.model_name
    assert ai.prompt_version == PROMPT_VERSION  # prompt version recorded
    assert ai.median == 57.0
    assert len(ai.histogram) == 20
    assert sum(ai.histogram) == pytest.approx(1.0)
    assert ai.rationale == "canned rationale"
    assert client.calls == 1


def test_prompt_mentions_the_thing_and_the_scale_poles() -> None:
    prompt = build_prompt(_make_pairing())
    assert "Thing 1" in prompt
    assert "left 1" in prompt
    assert "right 1" in prompt


def test_histogram_is_normalized_to_sum_to_one() -> None:
    payload = _valid_payload()
    payload["histogram"] = [2.0] + [0.0] * 19
    payload["q25"], payload["median"], payload["q75"] = 0.0, 2.5, 5.0

    parsed = parse_response(json.dumps(payload))

    assert sum(parsed["histogram"]) == pytest.approx(1.0)
    assert parsed["histogram"][0] == pytest.approx(1.0)


# --- Retry / backoff / fallback ---------------------------------------------


def test_malformed_json_is_retried_with_backoff_then_succeeds() -> None:
    pairing = _make_pairing()
    client = FakeGeminiClient(["not json at all", "{still bad", _valid_response()])
    sleeps: list[float] = []

    ai = generate_ai_distribution(pairing, client, sleep=sleeps.append, backoff_base=2.0)

    assert ai is not None
    assert client.calls == 3
    assert sleeps == [1.0, 2.0]  # backoff_base**0, backoff_base**1


def test_api_errors_are_retried_too() -> None:
    pairing = _make_pairing()
    client = FakeGeminiClient([RuntimeError("503 Service Unavailable"), _valid_response()])

    ai = generate_ai_distribution(pairing, client, sleep=lambda _s: None)

    assert ai is not None
    assert client.calls == 2


def test_rate_limit_skips_retries_and_falls_back_immediately() -> None:
    # A 429 quota rejection: our short backoff can't outwait the API's multi-second
    # retryDelay, so retrying only burns more of the tiny free-tier budget. Bail out
    # after a single call rather than firing all three attempts.
    pairing = _make_pairing()
    client = FakeGeminiClient([RuntimeError("429 RESOURCE_EXHAUSTED: quota exceeded")])
    sleeps: list[float] = []

    result = generate_ai_distribution(pairing, client, sleep=sleeps.append)

    assert result is None  # pioneer mode
    assert AIDistribution.objects.filter(pairing=pairing).count() == 0
    assert client.calls == 1  # no wasted retries against an exhausted quota
    assert sleeps == []


def test_rate_limit_arms_a_cooldown_that_skips_later_calls_without_hitting_the_api() -> None:
    # One 429 means the *account* is out of budget, not just this pairing — so the
    # next queued task must not fire another doomed request. It should short-circuit
    # to pioneer mode without touching the client until the quota resets.
    now = 1_000.0
    first = FakeGeminiClient([RuntimeError(_DAILY_429)])
    assert generate_ai_distribution(_make_pairing(1), first, now=lambda: now) is None
    assert first.calls == 1

    # A second pairing whose client *would* succeed — but we're in cooldown.
    second = FakeGeminiClient([_valid_response()])
    result = generate_ai_distribution(_make_pairing(2), second, now=lambda: now)

    assert result is None
    assert second.calls == 0  # the wall isn't probed again
    assert ai.cooldown_remaining(now) > 0


def test_daily_quota_cooldown_lasts_until_reset_not_the_short_retry_hint() -> None:
    # The daily quota won't clear for hours, so a 29s retryDelay hint is misleading:
    # we cool down until the actual midnight-Pacific rollover instead.
    now = 1_000.0
    generate_ai_distribution(_make_pairing(), FakeGeminiClient([RuntimeError(_DAILY_429)]),
                             now=lambda: now)
    assert ai.cooldown_remaining(now) > 60.0  # far longer than the 29s hint


def test_per_minute_rate_limit_honours_the_short_retry_delay() -> None:
    # A transient per-minute cap really does clear in seconds, so we honour its hint.
    now = 1_000.0
    generate_ai_distribution(_make_pairing(), FakeGeminiClient([RuntimeError(_PER_MINUTE_429)]),
                             now=lambda: now)
    remaining = ai.cooldown_remaining(now)
    assert 0 < remaining <= 30.0  # ~29s retryDelay, not a day


def test_calls_resume_once_the_cooldown_expires() -> None:
    armed_at = 1_000.0
    generate_ai_distribution(_make_pairing(1), FakeGeminiClient([RuntimeError(_PER_MINUTE_429)]),
                             now=lambda: armed_at)

    # Well past the ~29s cooldown, a fresh pairing is estimated normally again.
    later = armed_at + 120.0
    client = FakeGeminiClient([_valid_response()])
    result = generate_ai_distribution(_make_pairing(2), client, now=lambda: later)

    assert result is not None
    assert client.calls == 1


def test_persistent_failure_falls_back_to_pioneer_mode() -> None:
    pairing = _make_pairing()
    client = FakeGeminiClient(["still not json"])  # repeats the last response
    sleeps: list[float] = []

    result = generate_ai_distribution(pairing, client, sleep=sleeps.append)

    assert result is None  # pure pioneer mode: nothing stored
    assert AIDistribution.objects.filter(pairing=pairing).count() == 0
    assert client.calls == 3  # default max_attempts
    assert sleeps == [1.0, 2.0]


def test_missing_required_field_is_rejected() -> None:
    pairing = _make_pairing()
    payload = _valid_payload()
    del payload["median"]
    client = FakeGeminiClient([json.dumps(payload)])

    assert generate_ai_distribution(pairing, client, sleep=lambda _s: None) is None


def test_wrong_histogram_length_is_rejected() -> None:
    pairing = _make_pairing()
    payload = _valid_payload()
    payload["histogram"] = [0.1] * 10  # not the 20-bucket contract
    client = FakeGeminiClient([json.dumps(payload)])

    assert generate_ai_distribution(pairing, client, sleep=lambda _s: None) is None


def test_disordered_quantiles_are_rejected() -> None:
    pairing = _make_pairing()
    payload = _valid_payload()
    payload["q25"], payload["median"], payload["q75"] = 70.0, 55.0, 60.0  # q25 > median
    client = FakeGeminiClient([json.dumps(payload)])

    assert generate_ai_distribution(pairing, client, sleep=lambda _s: None) is None


# --- Idempotency & isolation ------------------------------------------------


def test_worker_is_idempotent_per_pairing() -> None:
    pairing = _make_pairing()
    client = FakeGeminiClient([_valid_response(), _valid_response()])

    first = generate_ai_distribution(pairing, client)
    second = generate_ai_distribution(pairing, client)

    assert first.pk == second.pk
    assert AIDistribution.objects.filter(pairing=pairing).count() == 1
    assert client.calls == 1  # the second call short-circuits before any API hit


def test_ai_distribution_never_enters_the_human_baseline() -> None:
    pairing = _make_pairing()
    crowd = Player.objects.create(device_token="tok-crowd")
    for center in [48.0, 50.0, 50.0, 50.0, 52.0]:
        Guess.objects.create(
            pairing=pairing, player=crowd, center=center,
            width_left=5, width_right=5, response_ms=3000,
        )
    # A wildly different AI prior that must never influence the snapshot.
    AIDistribution.objects.create(
        pairing=pairing, model_name="gemini-x", prompt_version="v1",
        histogram=[0.0] * 19 + [1.0], median=97.0, q25=95.0, q75=99.0, rationale="",
    )

    snapshot = recompute_snapshot(pairing)

    assert snapshot.n == 5  # only the human guesses were counted
    assert snapshot.median == pytest.approx(50.0, abs=2.0)  # AI's 97 did not leak in
    assert AIDistribution.objects.filter(pairing=pairing).count() == 1
    assert list(eligible_guesses(pairing).values_list("center", flat=True)) == [
        48.0, 50.0, 50.0, 50.0, 52.0
    ]


# --- Celery task & round-API trigger ----------------------------------------


def test_the_celery_task_delegates_to_the_service(monkeypatch) -> None:
    pairing = _make_pairing()
    fake = FakeGeminiClient([_valid_response()])
    monkeypatch.setattr("core.ai.get_gemini_client", lambda: fake)

    from core.tasks import estimate_distribution

    result_pk = estimate_distribution(pairing.pk)  # run synchronously

    assert result_pk is not None
    assert AIDistribution.objects.get(pk=result_pk).pairing_id == pairing.pk


def test_missing_pairing_is_a_no_op_for_the_task() -> None:
    from core.tasks import estimate_distribution

    assert estimate_distribution(999_999) is None


def test_next_round_schedules_cold_start_for_a_fresh_pairing(monkeypatch) -> None:
    from core import tasks

    scheduled: list[int] = []
    monkeypatch.setattr(tasks, "_enqueue_fast", lambda task, args: scheduled.append(args[0]))

    pairing = _make_pairing()
    client = APIClient()
    _session(client)

    assert client.get("/api/round/next/").status_code == 200
    assert scheduled == [pairing.pk]


def test_next_round_does_not_schedule_for_a_graduated_pairing(monkeypatch) -> None:
    from core import tasks

    scheduled: list[int] = []
    monkeypatch.setattr(tasks, "_enqueue_fast", lambda task, args: scheduled.append(args[0]))

    _graduated_pairing()
    client = APIClient()
    _session(client)

    assert client.get("/api/round/next/").status_code == 200
    assert scheduled == []


# --- Manual smoke test against the real API (excluded from CI) ---------------


@pytest.mark.external
def test_real_gemini_smoke() -> None:  # pragma: no cover - manual only
    import os

    if not os.environ.get("GEMINI_API_KEY"):
        pytest.skip("set GEMINI_API_KEY to run the real-API smoke test")

    from core.ai import get_gemini_client

    ai = generate_ai_distribution(_make_pairing(), get_gemini_client())
    assert ai is not None
    assert len(ai.histogram) == 20
    assert 0.0 <= ai.median <= 100.0

"""Gemini cold-start worker internals (WP-07).

When a fresh pairing has no trustworthy human baseline yet (plan §1.5), we ask
an LLM for a provisional distribution estimate. Design rules enforced here:

- **Faked in tests, real in production.** Everything talks to a small client
  protocol (:class:`FakeGeminiClient` in tests, :class:`GeminiClient` against
  the official ``google-genai`` SDK in production). The SDK is imported lazily
  so unit tests never need it.
- **Schema-validated.** Model output is parsed and validated against
  :data:`AI_RESPONSE_SCHEMA` before it is trusted; anything malformed raises
  :class:`InvalidAIResponse` and is retried.
- **Deterministic retries.** :func:`generate_ai_distribution` retries with an
  injected ``sleep`` (the project's determinism rule) and, once attempts are
  exhausted, falls back to pure pioneer mode by writing nothing.
- **Versioned & isolated.** Every estimate records its model name and
  :data:`PROMPT_VERSION`; the row lives in ``AIDistribution`` and never touches
  the human baseline (that isolation is a table boundary, tested in WP-03/07).
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

import jsonschema

from bglib.scoring import N_BUCKETS, SCALE_MAX
from core.models import AIDistribution, Pairing

logger = logging.getLogger(__name__)

#: Bump when the prompt wording changes so estimates stay comparable per version.
PROMPT_VERSION = "v1"

#: Default number of Gemini attempts before falling back to pioneer mode.
MAX_ATTEMPTS = 3

#: Where the Gemini free-tier *daily* request quota rolls over. Google resets it
#: at midnight Pacific, so we cool down until then rather than probe uselessly.
QUOTA_RESET_TZ = ZoneInfo("America/Los_Angeles")

#: Cooldown to use for a rate-limit error that carries no usable ``retryDelay``.
DEFAULT_RATE_COOLDOWN = 60.0

#: JSON contract the model must satisfy. A 20-bucket histogram keeps AI and
#: human distributions directly comparable (same buckets as the snapshot).
AI_RESPONSE_SCHEMA = {
    "type": "object",
    "required": ["median", "q25", "q75", "histogram", "rationale"],
    "properties": {
        "median": {"type": "number", "minimum": 0, "maximum": SCALE_MAX},
        "q25": {"type": "number", "minimum": 0, "maximum": SCALE_MAX},
        "q75": {"type": "number", "minimum": 0, "maximum": SCALE_MAX},
        "histogram": {
            "type": "array",
            "items": {"type": "number", "minimum": 0},
            "minItems": N_BUCKETS,
            "maxItems": N_BUCKETS,
        },
        "rationale": {"type": "string"},
    },
    "additionalProperties": True,
}


class InvalidAIResponse(ValueError):
    """The model's output did not satisfy the distribution contract."""


def _is_rate_limited(exc: Exception) -> bool:
    """Whether ``exc`` is a Gemini quota / rate-limit rejection (HTTP 429).

    The free tier allows only ~5 requests/minute/model and answers overflow with
    ``429 RESOURCE_EXHAUSTED`` plus a ``retryDelay`` on the order of tens of
    seconds. Our in-function backoff (1-2 s) is far too short to outwait that, so
    fast-retrying just burns three requests for nothing. Detect it and bail out
    of the retry loop immediately, leaving the quota for the next task.
    """
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if code == 429:
        return True
    text = str(exc).upper()
    return "RESOURCE_EXHAUSTED" in text or "429" in text or "RATE LIMIT" in text


# ---------------------------------------------------------------------------
# Rate-limit cooldown
# ---------------------------------------------------------------------------
#
# A single 429 tells us the whole account is out of budget, not just this one
# pairing — so probing again with the next queued task just hammers a wall that
# won't move for a while. Instead we read the server's own reset hint and pause
# *all* Gemini calls in this worker process until then; queued tasks short-circuit
# to pioneer mode meanwhile instead of each firing a doomed request.
#
# State is per worker process (in-memory). With prefork concurrency each child
# keeps its own gate, so a restart clears it — a fresh probe then re-arms it.

_cooldown_until: float = 0.0  # wall-clock epoch seconds; calls pause until then

_RETRY_DELAY_RE = re.compile(r"retryDelay['\"]?\s*[:=]\s*['\"]?(\d+(?:\.\d+)?)\s*s")


def reset_cooldown() -> None:
    """Clear the rate-limit cooldown (used by tests and on manual recovery)."""
    global _cooldown_until
    _cooldown_until = 0.0


def cooldown_remaining(now: float | None = None) -> float:
    """Seconds until Gemini calls may resume (0.0 if not cooling down)."""
    return max(0.0, _cooldown_until - (time.time() if now is None else now))


def _enter_cooldown(seconds: float, now: float) -> None:
    global _cooldown_until
    _cooldown_until = max(_cooldown_until, now + seconds)


def _retry_delay_seconds(exc: Exception) -> float | None:
    """The API's suggested ``retryDelay`` in seconds, if the error carries one."""
    match = _RETRY_DELAY_RE.search(str(exc))
    return float(match.group(1)) if match else None


def _is_daily_quota(exc: Exception) -> bool:
    """Whether the 429 is a *daily* quota (vs. a transient per-minute rate cap)."""
    return "PerDay" in str(exc)


def _seconds_until_daily_reset(now: float) -> float:
    """Seconds from ``now`` (epoch) to the next Gemini daily-quota reset."""
    local = datetime.fromtimestamp(now, tz=QUOTA_RESET_TZ)
    reset = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(DEFAULT_RATE_COOLDOWN, (reset - local).total_seconds())


def _cooldown_for(exc: Exception, now: float) -> float:
    """How long to pause after ``exc``: until reset for a daily cap, else retryDelay.

    A daily quota won't clear for hours, so the server's short ``retryDelay`` hint
    is misleading there — we wait until the actual midnight-Pacific rollover. A
    per-minute rate cap does clear quickly, so we honour its ``retryDelay``.
    """
    if _is_daily_quota(exc):
        return _seconds_until_daily_reset(now)
    return _retry_delay_seconds(exc) or DEFAULT_RATE_COOLDOWN


class GeminiClient(Protocol):
    """Anything that turns a prompt into a raw (hopefully JSON) string."""

    model_name: str

    def generate(self, prompt: str) -> str: ...


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------


def build_prompt(pairing: Pairing) -> str:
    """Prompt asking for the *societal* distribution of a Thing on a Scale.

    Versioned by :data:`PROMPT_VERSION`; keep changes in lockstep with it.
    """
    return (
        "You are estimating how a broad, representative population would place a "
        "concept on a bipolar 0-100 scale.\n\n"
        f'Concept (the "Thing"): {pairing.thing.text}\n'
        f"Scale: 0 means fully \"{pairing.scale.left_label}\", "
        f'100 means fully "{pairing.scale.right_label}".\n\n'
        "Estimate the distribution of where people would put this concept. "
        "Respond with ONLY a JSON object, no prose, with keys:\n"
        '  "median": number 0-100,\n'
        '  "q25": number 0-100 (25th percentile),\n'
        '  "q75": number 0-100 (75th percentile),\n'
        f'  "histogram": array of exactly {N_BUCKETS} non-negative numbers '
        f"(mass per equal bucket across 0-100, summing to ~1),\n"
        '  "rationale": one short sentence.\n'
        "Ensure q25 <= median <= q75."
    )


# ---------------------------------------------------------------------------
# Parsing & validation
# ---------------------------------------------------------------------------


def parse_response(raw: str) -> dict:
    """Parse and validate a raw model response into normalized fields.

    Raises :class:`InvalidAIResponse` on anything that violates the contract.
    The histogram is renormalized to sum to 1 so downstream comparisons are
    on the same footing as human snapshots.
    """
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise InvalidAIResponse(f"response was not valid JSON: {exc}") from exc

    try:
        jsonschema.validate(data, AI_RESPONSE_SCHEMA)
    except jsonschema.ValidationError as exc:
        raise InvalidAIResponse(f"response violated the schema: {exc.message}") from exc

    histogram = [float(x) for x in data["histogram"]]
    total = sum(histogram)
    if total <= 0:
        raise InvalidAIResponse("histogram has no mass")
    histogram = [x / total for x in histogram]

    median, q25, q75 = float(data["median"]), float(data["q25"]), float(data["q75"])
    if not 0.0 <= q25 <= median <= q75 <= SCALE_MAX:
        raise InvalidAIResponse("quantiles are out of order or off-scale")

    return {
        "median": median,
        "q25": q25,
        "q75": q75,
        "histogram": histogram,
        "rationale": str(data["rationale"]).strip(),
    }


# ---------------------------------------------------------------------------
# The worker service
# ---------------------------------------------------------------------------


def generate_ai_distribution(
    pairing: Pairing,
    client: GeminiClient,
    *,
    max_attempts: int = MAX_ATTEMPTS,
    sleep=time.sleep,
    backoff_base: float = 2.0,
    now=time.time,
) -> AIDistribution | None:
    """Fetch, validate, and store an AI estimate for ``pairing``.

    Idempotent per (pairing, model, prompt version): returns the existing row
    without calling the API. Retries transient/malformed responses with an
    injected ``sleep`` for determinism, and returns ``None`` (pure pioneer
    mode) once ``max_attempts`` are exhausted.

    Respects a process-wide rate-limit cooldown: if a recent 429 armed it, the
    call short-circuits to pioneer mode without touching the API until the
    quota's reset time (see :func:`_cooldown_for`). ``now`` is injectable for
    deterministic tests.
    """
    existing = AIDistribution.objects.filter(
        pairing=pairing, model_name=client.model_name, prompt_version=PROMPT_VERSION
    ).first()
    if existing is not None:
        return existing

    remaining = cooldown_remaining(now())
    if remaining > 0:
        logger.info(
            "AI estimate for pairing %s skipped: quota cooldown, ~%.0fs remaining",
            pairing.pk, remaining,
        )
        return None

    prompt = build_prompt(pairing)
    for attempt in range(1, max_attempts + 1):
        try:
            parsed = parse_response(client.generate(prompt))
        except Exception as exc:  # any client/parse failure is retryable
            if _is_rate_limited(exc):
                # Quota exhausted: this isn't specific to one pairing, so arm a
                # process-wide cooldown until the quota resets and stop probing.
                # Retrying now (or on the next queued task) only hammers a wall
                # that won't move — the server's own reset hint tells us how long.
                cooldown = _cooldown_for(exc, now())
                _enter_cooldown(cooldown, now())
                logger.warning(
                    "AI estimate rate-limited for pairing %s; pausing AI calls "
                    "for ~%.0fs until quota resets: %s",
                    pairing.pk, cooldown, exc,
                )
                return None
            logger.warning(
                "AI estimate attempt %s/%s failed for pairing %s: %s",
                attempt, max_attempts, pairing.pk, exc,
            )
            if attempt < max_attempts:
                sleep(backoff_base ** (attempt - 1))
            continue
        return AIDistribution.objects.create(
            pairing=pairing,
            model_name=client.model_name,
            prompt_version=PROMPT_VERSION,
            histogram=parsed["histogram"],
            median=parsed["median"],
            q25=parsed["q25"],
            q75=parsed["q75"],
            rationale=parsed["rationale"],
        )
    return None


# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------


class FakeGeminiClient:
    """Test double: replays canned responses (strings or exceptions to raise).

    Each ``generate`` call consumes the next response; once the list is
    exhausted the final entry repeats, so ``FakeGeminiClient(["bad"])`` fails
    on every attempt.
    """

    def __init__(self, responses, model_name: str = "fake-gemini-1.0") -> None:
        if not responses:
            raise ValueError("FakeGeminiClient needs at least one response")
        self._responses = list(responses)
        self.model_name = model_name
        self.calls = 0
        self.prompts: list[str] = []

    def generate(self, prompt: str) -> str:
        self.prompts.append(prompt)
        item = self._responses[min(self.calls, len(self._responses) - 1)]
        self.calls += 1
        if isinstance(item, Exception):
            raise item
        return item


class RealGeminiClient:
    """Production client backed by the official ``google-genai`` SDK.

    Imported lazily so unit tests (which use :class:`FakeGeminiClient`) never
    require the SDK to be installed.
    """

    def __init__(self, api_key: str, model_name: str) -> None:
        self._api_key = api_key
        self.model_name = model_name

    def generate(self, prompt: str) -> str:
        from google import genai

        client = genai.Client(api_key=self._api_key)
        response = client.models.generate_content(
            model=self.model_name,
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )
        return response.text or ""


def get_gemini_client() -> GeminiClient:
    """Build the production client from settings (used by the Celery task)."""
    from django.conf import settings

    return RealGeminiClient(
        api_key=settings.GEMINI_API_KEY, model_name=settings.GEMINI_MODEL
    )

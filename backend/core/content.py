"""Player-generated content: filtering + LLM sanity check (WP-11, plan §1.6).

Submissions flow: profanity/PII filter -> LLM sanity check -> moderation queue.
The sanity check reuses the WP-07 Gemini client and maps a verdict onto the
content's status:

- ``accept`` -> ACTIVE (goes live),
- ``queue``  -> DRAFT  (held for a human moderator),
- ``reject`` -> REJECTED.

On any model/parse failure the item falls back to ``queue`` — a human looks,
nothing bad goes live automatically.
"""

import json
import re

import jsonschema

from core.models import ContentStatus, Scale, Thing

#: Minimum player level to unlock content submission (plan §1.6, ~level 10).
#: Overridable via settings.CONTENT_SUGGEST_LEVEL.
DEFAULT_SUGGEST_LEVEL = 10

# Deliberately tiny illustrative filter; a real deployment loads a fuller list.
_BLOCKLIST = {"slur-placeholder"}
_PII_RE = re.compile(
    r"[\w.+-]+@[\w-]+\.[\w.-]+"  # emails
    r"|\b\d{3}[-.\s]?\d{3,4}[-.\s]?\d{4}\b"  # phone-ish numbers
)

SANITY_SCHEMA = {
    "type": "object",
    "required": ["verdict"],
    "properties": {
        "verdict": {"enum": ["accept", "queue", "reject"]},
        "reason": {"type": "string"},
    },
    "additionalProperties": True,
}

_STATUS_BY_VERDICT = {
    "accept": ContentStatus.ACTIVE,
    "queue": ContentStatus.DRAFT,
    "reject": ContentStatus.REJECTED,
}


def is_clean(*parts: str) -> bool:
    """Reject obvious profanity or PII before anything is stored or sent to an LLM."""
    for text in parts:
        if _PII_RE.search(text):
            return False
        low = text.lower()
        if any(term in low for term in _BLOCKLIST):
            return False
    return True


def build_thing_prompt(text: str) -> str:
    return (
        "You are vetting a user-submitted concept for a guessing game.\n"
        f'Concept: "{text}"\n'
        "Is it a real, broadly-known thing suitable to place on opinion scales? "
        'Respond with ONLY JSON: {"verdict": "accept"|"queue"|"reject", "reason": "..."}. '
        'Use "queue" if unsure.'
    )


def build_scale_prompt(left: str, right: str) -> str:
    return (
        "You are vetting a user-submitted bipolar scale for a guessing game.\n"
        f'Scale: "{left}" (0) <-> "{right}" (100)\n'
        "Is it a meaningful, opinion-bearing dimension with genuinely opposite poles? "
        'Respond with ONLY JSON: {"verdict": "accept"|"queue"|"reject", "reason": "..."}. '
        'Use "queue" if unsure.'
    )


def _parse_verdict(raw: str) -> str:
    data = json.loads(raw)
    jsonschema.validate(data, SANITY_SCHEMA)
    return data["verdict"]


def run_sanity_check(obj, client) -> str:
    """Ask the LLM to vet ``obj`` (a Thing or Scale) and update its status.

    Returns the verdict. Any failure falls back to ``queue`` (human review).
    """
    prompt = (
        build_thing_prompt(obj.text)
        if isinstance(obj, Thing)
        else build_scale_prompt(obj.left_label, obj.right_label)
    )
    try:
        verdict = _parse_verdict(client.generate(prompt))
    except Exception:
        verdict = "queue"
    obj.status = _STATUS_BY_VERDICT.get(verdict, ContentStatus.DRAFT)
    obj.save(update_fields=["status"])
    return verdict


def approve(obj) -> None:
    """Moderator action: publish a queued Thing/Scale."""
    obj.status = ContentStatus.ACTIVE
    obj.save(update_fields=["status"])


def reject(obj) -> None:
    """Moderator action: reject a queued Thing/Scale."""
    obj.status = ContentStatus.REJECTED
    obj.save(update_fields=["status"])


# Keep Scale importable from here for symmetry with Thing (used by callers/tests).
__all__ = [
    "DEFAULT_SUGGEST_LEVEL",
    "Scale",
    "Thing",
    "approve",
    "build_scale_prompt",
    "build_thing_prompt",
    "is_clean",
    "reject",
    "run_sanity_check",
]

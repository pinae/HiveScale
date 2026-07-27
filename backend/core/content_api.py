"""Player-generated content submission endpoints (WP-11, plan §1.6).

Level-gated: only experienced players may suggest Things/Scales. Submissions are
filtered for profanity/PII, stored as DRAFT, and handed to an async LLM sanity
check (see core.tasks) which decides accept/queue/reject.
"""

import secrets

from django.conf import settings
from django.utils.text import slugify
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from core.content import is_clean
from core.models import ContentStatus, Scale, Thing
from core.sessions import resolve_player
from core.tasks import schedule_sanity_check


def _suggest_level() -> int:
    return getattr(settings, "CONTENT_SUGGEST_LEVEL", 10)


def _unique_slug(model, base: str) -> str:
    slug = slugify(base)[:130] or "item"
    if not model.objects.filter(slug=slug).exists():
        return slug
    return f"{slug[:120]}-{secrets.token_hex(3)}"


def _bad_request(detail: str) -> Response:
    return Response({"detail": detail}, status=status.HTTP_400_BAD_REQUEST)


def _gate(request):
    """Return (player, None) if allowed, else (None, error Response)."""
    player = resolve_player(request)
    if player is None:
        return None, Response({"detail": "No active session."}, status=status.HTTP_401_UNAUTHORIZED)
    if player.level < _suggest_level():
        return None, Response(
            {"detail": f"Reach level {_suggest_level()} to suggest content."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return player, None


@api_view(["POST"])
def submit_thing(request) -> Response:
    player, denied = _gate(request)
    if denied is not None:
        return denied

    text = str(request.data.get("text", "")).strip()
    if not 1 <= len(text) <= 120:
        return _bad_request("Enter a concept (1-120 chars).")
    if not is_clean(text):
        return _bad_request("That submission was blocked.")

    thing = Thing.objects.create(
        text=text, slug=_unique_slug(Thing, text), status=ContentStatus.DRAFT, created_by=player
    )
    schedule_sanity_check("thing", thing.pk)
    return Response(
        {"id": thing.pk, "text": thing.text, "status": thing.status},
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
def submit_scale(request) -> Response:
    player, denied = _gate(request)
    if denied is not None:
        return denied

    left = str(request.data.get("left", "")).strip()
    right = str(request.data.get("right", "")).strip()
    if not (1 <= len(left) <= 60 and 1 <= len(right) <= 60):
        return _bad_request("Enter both poles (1-60 chars).")
    if not is_clean(left, right):
        return _bad_request("That submission was blocked.")

    scale = Scale.objects.create(
        left_label=left,
        right_label=right,
        slug=_unique_slug(Scale, f"{left}-{right}"),
        status=ContentStatus.DRAFT,
        created_by=player,
    )
    schedule_sanity_check("scale", scale.pk)
    return Response(
        {
            "id": scale.pk,
            "left": scale.left_label,
            "right": scale.right_label,
            "status": scale.status,
        },
        status=status.HTTP_201_CREATED,
    )

"""Scale-request endpoints (plan §2.x, unlocked at level 15).

``GET /api/scale-request/`` offers (at most once a day, after a few rounds) a
random thing plus its already-used scales, and a signed token; ``POST
/api/scale-request/`` files the player's surprising new scale for that thing.
"""

from django.core import signing
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from core import scale_requests
from core.models import Thing
from core.sessions import resolve_player


def _gate(request):
    player = resolve_player(request)
    if player is None:
        return None, Response({"detail": "No active session."}, status=status.HTTP_401_UNAUTHORIZED)
    if player.level < scale_requests.scale_request_level():
        return None, Response(
            {"detail": f"Reach level {scale_requests.scale_request_level()} to craft scales."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return player, None


@extend_schema(responses={200: OpenApiTypes.OBJECT})
@api_view(["GET"])
def scale_request(request) -> Response:
    """Today's scale prompt, or why it isn't available yet."""
    player, denied = _gate(request)
    if denied is not None:
        return denied

    day = timezone.localdate()
    state = scale_requests.availability(player, day)
    if not state["available"]:
        return Response(state)

    thing = scale_requests.pick_thing()
    if thing is None:
        return Response({"available": False, "reason": "No things to build a scale for yet."})

    return Response(
        {
            "available": True,
            "thing": {"id": thing.pk, "text": thing.text},
            "examples": scale_requests.example_scales(thing),
            "scale_request_token": scale_requests.issue_token(player, thing),
        }
    )


@extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
@api_view(["POST"])
def submit_scale_request(request) -> Response:
    """File a new surprising scale for the prompted thing."""
    player, denied = _gate(request)
    if denied is not None:
        return denied

    day = timezone.localdate()
    if player.last_scale_request_on == day:
        return Response(
            {"detail": "You've already crafted a scale today."}, status=status.HTTP_400_BAD_REQUEST
        )

    try:
        ticket = scale_requests.load_token(str(request.data.get("scale_request_token", "")))
    except signing.BadSignature:
        return Response(
            {"detail": "Invalid or expired scale prompt."}, status=status.HTTP_400_BAD_REQUEST
        )
    if ticket["u"] != player.pk:
        return Response(
            {"detail": "This prompt was dealt to a different player."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    left = str(request.data.get("left", "")).strip()
    right = str(request.data.get("right", "")).strip()
    if not scale_requests.is_valid_scale(left, right):
        return Response(
            {"detail": "Enter both poles (1-60 chars each)."}, status=status.HTTP_400_BAD_REQUEST
        )

    thing = Thing.objects.filter(pk=ticket["t"]).first()
    if thing is None:
        return Response({"detail": "That thing no longer exists."}, status=400)

    return Response(scale_requests.submit(player, thing, left, right, day))

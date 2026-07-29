"""Thing-challenge endpoints (plan §2.x, unlocked at level 10).

``GET /api/challenge/next/`` deals two random scales and a signed token; ``POST
/api/challenge/`` accepts a ≤3-word thing that maxes the first scale and mins the
second, banks the flat bonus, and files the thing for moderation.
"""

from django.core import signing
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from core import challenges, leveling, voting
from core.models import Scale
from core.sessions import resolve_player


def _gate(request):
    player = resolve_player(request)
    if player is None:
        return None, Response({"detail": "No active session."}, status=status.HTTP_401_UNAUTHORIZED)
    if player.level < challenges.challenge_level():
        return None, Response(
            {"detail": f"Reach level {challenges.challenge_level()} to take on challenges."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return player, None


def _scale(scale: Scale) -> dict:
    return {"id": scale.pk, "left": scale.left_label, "right": scale.right_label}


def _profile_delta(player) -> dict:
    return {
        "player": {"xp": player.xp, "level": player.level, "multiplier": player.xp_multiplier},
        "progress": leveling.level_progress(player.xp),
        "unlocks": voting.unlocks(player),
    }


@extend_schema(responses={200: OpenApiTypes.OBJECT})
@api_view(["GET"])
def next_challenge(request) -> Response:
    """Two scales + a signed token: name a thing that maxes the first, mins the second."""
    player, denied = _gate(request)
    if denied is not None:
        return denied
    pair = challenges.pick_two_scales()
    if pair is None:
        return Response(
            {"detail": "Not enough scales for a challenge yet."}, status=status.HTTP_404_NOT_FOUND
        )
    first, second = pair
    return Response(
        {
            "first_scale": _scale(first),
            "second_scale": _scale(second),
            "max_words": challenges.MAX_WORDS,
            "reward_xp": challenges.CHALLENGE_XP,
            "challenge_token": challenges.issue_token(player, first, second),
        }
    )


@extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
@api_view(["POST"])
def submit_challenge(request) -> Response:
    """Submit a ≤3-word thing for the dealt challenge; banks the bonus."""
    player, denied = _gate(request)
    if denied is not None:
        return denied

    try:
        ticket = challenges.load_token(str(request.data.get("challenge_token", "")))
    except signing.BadSignature:
        return Response(
            {"detail": "Invalid or expired challenge."}, status=status.HTTP_400_BAD_REQUEST
        )
    if ticket["u"] != player.pk:
        return Response(
            {"detail": "This challenge was dealt to a different player."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    text = str(request.data.get("text", "")).strip()
    if not challenges.is_valid_answer(text):
        return Response(
            {"detail": f"Enter a thing in {challenges.MAX_WORDS} words or fewer."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    first = Scale.objects.filter(pk=ticket["a"]).first()
    second = Scale.objects.filter(pk=ticket["b"]).first()
    if first is None or second is None:
        return Response({"detail": "This challenge is no longer valid."}, status=400)

    result = challenges.submit(player, first, second, text)
    return Response({**result, **_profile_delta(player)})

"""Pairing-voting endpoints (plan §2.x, unlocked at level 5).

``GET /api/vote/next/`` serves a thing+scale to judge — a fresh candidate combo
or an existing pairing — and ``POST /api/vote/`` records the fun/interesting/
boring/weird verdict, promoting candidates or retiring disliked pairings.
"""

import random

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from core import voting
from core.models import Scale, Thing, VoteChoice
from core.sessions import resolve_player


def _gate(request):
    player = resolve_player(request)
    if player is None:
        return None, Response({"detail": "No active session."}, status=status.HTTP_401_UNAUTHORIZED)
    if player.level < voting.vote_level():
        return None, Response(
            {"detail": f"Reach level {voting.vote_level()} to vote on pairings."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return player, None


def _serialize(thing: Thing, scale: Scale, pairing_id: int | None) -> dict:
    return {
        "thing": {"id": thing.pk, "text": thing.text},
        "scale": {"id": scale.pk, "left": scale.left_label, "right": scale.right_label},
        "pairing_id": pairing_id,
        "existing": pairing_id is not None,
    }


@extend_schema(responses={200: OpenApiTypes.OBJECT})
@api_view(["GET"])
def next_vote(request) -> Response:
    """A thing+scale to judge: a fresh candidate or an existing pairing (mixed)."""
    player, denied = _gate(request)
    if denied is not None:
        return denied

    rng = random.Random()
    # Prefer a fresh candidate half the time; fall back to whichever exists.
    if rng.random() < 0.5:
        candidate = voting.random_candidate(rng)
        if candidate is not None:
            return Response(_serialize(candidate[0], candidate[1], None))
        existing = voting.random_existing(rng)
    else:
        existing = voting.random_existing(rng)
        if existing is None:
            candidate = voting.random_candidate(rng)
            if candidate is not None:
                return Response(_serialize(candidate[0], candidate[1], None))

    if existing is not None:
        return Response(_serialize(existing.thing, existing.scale, existing.pk))
    return Response({"detail": "Nothing to vote on right now."}, status=status.HTTP_404_NOT_FOUND)


@extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
@api_view(["POST"])
def cast_vote(request) -> Response:
    """Record a fun/interesting/boring/weird verdict on a thing+scale."""
    player, denied = _gate(request)
    if denied is not None:
        return denied

    choice = str(request.data.get("choice", ""))
    if choice not in VoteChoice.values:
        return Response({"detail": "Unknown vote."}, status=status.HTTP_400_BAD_REQUEST)

    thing = Thing.objects.filter(pk=request.data.get("thing_id")).first()
    scale = Scale.objects.filter(pk=request.data.get("scale_id")).first()
    if thing is None or scale is None:
        return Response({"detail": "Unknown thing or scale."}, status=status.HTTP_400_BAD_REQUEST)

    return Response(voting.record_vote(player, thing, scale, choice))

"""API views: health (WP-01), sessions & claiming (WP-04)."""

from django.conf import settings
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from core.archetypes import calibration_summary, classify
from core.models import Player
from core.services import claim_player
from core.sessions import attach_session_cookie, new_device_token, resolve_player

_CLAIM_SALT = "hivescale.claim"
_CLAIM_MAX_AGE = 60 * 30  # magic links are valid for 30 minutes


@api_view(["GET"])
def health(request) -> Response:
    """Liveness probe used by docker-compose healthchecks, CI, and Playwright."""
    return Response({"status": "ok", "service": "hivescale"})


def _profile(player: Player) -> dict:
    return {"level": player.level, "xp": player.xp, "is_claimed": player.user_id is not None}


def _unauthorized() -> Response:
    return Response({"detail": "No active session."}, status=status.HTTP_401_UNAUTHORIZED)


@api_view(["POST"])
def session(request) -> Response:
    """Create or refresh the anonymous session (plan §2.3: zero-login play)."""
    player = resolve_player(request)
    created = player is None
    if created:
        player = Player.objects.create(device_token=new_device_token())
    response = Response({"player": _profile(player), "created": created})
    attach_session_cookie(response, player)
    return response


@api_view(["GET"])
def me(request) -> Response:
    player = resolve_player(request)
    if player is None:
        return _unauthorized()
    return Response(_profile(player))


@api_view(["GET"])
def me_stats(request) -> Response:
    """Calibration curve, archetype, and streaks for the stats page (WP-11)."""
    player = resolve_player(request)
    if player is None:
        return _unauthorized()
    stats = player.calibration_stats or {}
    return Response(
        {
            "archetype": classify(stats),
            "calibration": calibration_summary(stats),
            "streaks": {
                "hot": player.hot_streak,
                "daily": player.daily_streak,
                "freezes": player.streak_freezes,
            },
            "xp": player.xp,
            "level": player.level,
        }
    )


@api_view(["POST"])
def claim_request(request) -> Response:
    """Start an account claim: issue a signed magic-link token for an email.

    Delivery is a stub (WP-04): in ``echo`` mode (dev/test default) the token
    is returned in the response; WP-11 replaces this with an actual email.
    """
    if resolve_player(request) is None:
        return _unauthorized()
    email = str(request.data.get("email", "")).strip().lower()
    try:
        validate_email(email)
    except ValidationError:
        return Response({"detail": "Enter a valid email."}, status=status.HTTP_400_BAD_REQUEST)

    token = signing.dumps({"email": email}, salt=_CLAIM_SALT)
    body = {"detail": "Claim link issued."}
    if settings.CLAIM_LINK_DELIVERY == "echo":
        body["claim_token"] = token
    return Response(body)


@api_view(["POST"])
def claim_confirm(request) -> Response:
    """Finish a claim: verify the magic-link token, link or merge, re-cookie."""
    player = resolve_player(request)
    if player is None:
        return _unauthorized()
    try:
        payload = signing.loads(
            str(request.data.get("claim_token", "")), salt=_CLAIM_SALT, max_age=_CLAIM_MAX_AGE
        )
    except signing.BadSignature:
        return Response(
            {"detail": "Invalid or expired claim link."}, status=status.HTTP_400_BAD_REQUEST
        )
    result, merged = claim_player(player, payload["email"])
    response = Response({"player": _profile(result), "merged": merged})
    attach_session_cookie(response, result)
    return response

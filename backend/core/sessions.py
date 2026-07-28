"""Anonymous session machinery (WP-04).

A player's identity is a random opaque token stored in ``Player.device_token``.
The browser only ever sees a *signed* version of it in an httpOnly cookie, so
tokens cannot be forged or read by page scripts. No PII is involved: an
anonymous player is a token plus game stats, nothing else.
"""

import secrets

from django.core.signing import BadSignature, TimestampSigner
from django.http import HttpRequest, HttpResponse

from core.models import Player

SESSION_COOKIE_NAME = "bg_player"
SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 400  # ~13 months of anonymous identity
_SIGNING_SALT = "hivescale.session"


def _signer() -> TimestampSigner:
    return TimestampSigner(salt=_SIGNING_SALT)


def new_device_token() -> str:
    return secrets.token_hex(16)


def resolve_player(request: HttpRequest) -> Player | None:
    """Return the player for the request's session cookie, if valid."""
    signed = request.COOKIES.get(SESSION_COOKIE_NAME)
    if not signed:
        return None
    try:
        token = _signer().unsign(signed, max_age=SESSION_COOKIE_MAX_AGE)
    except BadSignature:
        return None
    return Player.objects.filter(device_token=token).first()


def attach_session_cookie(response: HttpResponse, player: Player) -> None:
    """Set the signed, httpOnly session cookie for ``player`` on ``response``."""
    from django.conf import settings

    response.set_cookie(
        SESSION_COOKIE_NAME,
        _signer().sign(player.device_token),
        max_age=SESSION_COOKIE_MAX_AGE,
        httponly=True,
        samesite="Lax",
        secure=not settings.DEBUG,
    )


def rotate_device_token(player: Player) -> Player:
    """Give ``player`` a fresh token (invalidates every existing cookie)."""
    player.device_token = new_device_token()
    player.save(update_fields=["device_token"])
    return player

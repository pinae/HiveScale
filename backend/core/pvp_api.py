"""PvP match API: start, join, synchronise, answer (plan §2.x).

Endpoints
---------
``GET  /api/pvp/captcha/``            deal the anti-bot round for an email invite
``POST /api/pvp/start/``              open a match (share link, or email a friend)
``GET  /api/pvp/<code>/``             join on first read + the caller's match state
``POST /api/pvp/<code>/ready/``       barrier: long-poll until both players are in
``POST /api/pvp/<code>/guess/``       answer the current slot

Starting a battle needs ``MULTIPLAYER_LEVEL``; joining and playing one needs only
a session, so a challenged friend can play at any level.

The blind guarantee holds throughout: a slot's thing/scale is only serialised
once both players have released the barrier for it, and no distribution data
leaves before the answer is in (that lives in the reveal from ``score_and_record``).
"""

import time as _time

from django.conf import settings
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from bglib.scoring import Guess as GuessValue
from bglib.scoring import guess_to_distribution
from core import pvp
from core.captcha import NotHuman, verify_human
from core.emails import send_pvp_invite
from core.models import Pairing, PvpMatch
from core.round_api import ROUND_TOKEN_MAX_AGE, _bad_request, score_and_record
from core.scheduler import serialize_deal
from core.sessions import resolve_player

_CAPTCHA_SALT = "hivescale.pvp-captcha"
_SLOT_SALT = "hivescale.pvp-slot"


def _player_gate(request):
    """(player, None) for any signed-in player, else (None, error response).

    This is all a *participant* needs: being challenged is an invitation into the
    game, so an opponent plays at any level — including someone who has never
    played before and arrives straight from the invite link.
    """
    player = resolve_player(request)
    if player is None:
        return None, Response({"detail": "No active session."}, status=status.HTTP_401_UNAUTHORIZED)
    return player, None


def _gate(request):
    """(player, None) when allowed to *start* a battle, else (None, error).

    Only the challenger is level-gated — starting battles is the unlocked
    feature; accepting one is not.
    """
    player, denied = _player_gate(request)
    if denied is not None:
        return None, denied
    if player.level < pvp.multiplayer_level():
        return None, Response(
            {"detail": f"Reach level {pvp.multiplayer_level()} to battle a friend."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return player, None


def _guess_from(data) -> GuessValue:
    value = GuessValue(
        center=float(data.get("center")),
        width_left=float(data.get("width_left")),
        width_right=float(data.get("width_right")),
    )
    guess_to_distribution(value)  # validates geometry before any DB write
    return value


def _match_or_404(join_code: str) -> PvpMatch | None:
    return PvpMatch.objects.filter(join_code=join_code).first()


def _state_with_token(match: PvpMatch, player) -> dict:
    """Match state, with a signed slot ticket on a round that has actually started.

    The token is what ``pvp_guess`` accepts back, so a client can only answer a
    slot whose barrier both players have released.
    """
    state = pvp.match_state(match, player)
    nxt = state.get("next")
    if nxt and nxt.get("started"):
        nxt["pvp_token"] = issue_slot_token(match, player, nxt["index"])
    return state


@extend_schema(responses={200: OpenApiTypes.OBJECT})
@api_view(["GET"])
def pvp_captcha(request) -> Response:
    """Deal the round a challenger must play before we'll email their friend."""
    player, denied = _gate(request)
    if denied is not None:
        return denied
    try:
        pairing_id = pvp.rating_eligible_pairing_ids(size=1)[0]
    except pvp.PvpError as exc:
        return _bad_request(str(exc))
    pairing = Pairing.objects.select_related("thing", "scale").get(pk=pairing_id)
    deal = serialize_deal(pairing)
    return Response(
        {
            "captcha_token": signing.dumps(
                {"p": pairing.pk, "u": player.pk, "ts": _time.time()}, salt=_CAPTCHA_SALT
            ),
            "thing": deal["thing"],
            "scale": deal["scale"],
        }
    )


@extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
@api_view(["POST"])
def pvp_start(request) -> Response:
    """Open a match. ``mode="link"`` returns a share link; ``mode="email"`` invites."""
    player, denied = _gate(request)
    if denied is not None:
        return denied

    mode = str(request.data.get("mode", "link")).strip().lower()
    if mode not in {"link", "email"}:
        return _bad_request("Unknown invite mode.")

    invited_email = ""
    if mode == "email":
        # Only a player who has claimed their own account can email an invite —
        # otherwise the friend has no idea who is challenging them.
        challenger_email = getattr(getattr(player, "user", None), "email", "") or ""
        if not challenger_email:
            return Response(
                {
                    "detail": "Save your own progress with an email first, so your friend "
                    "can see who challenged them."
                },
                status=status.HTTP_403_FORBIDDEN,
            )
        invited_email = str(request.data.get("email", "")).strip().lower()
        try:
            validate_email(invited_email)
        except ValidationError:
            return _bad_request("Enter a valid email for your friend.")

        # Anti-bot: a real, counted round plus humanity checks, before any mail.
        try:
            ticket = signing.loads(
                str(request.data.get("captcha_token", "")),
                salt=_CAPTCHA_SALT,
                max_age=ROUND_TOKEN_MAX_AGE,
            )
        except signing.BadSignature:
            return _bad_request("That check expired. Please try again.")
        if ticket["u"] != player.pk:
            return _bad_request("That check was issued to a different player.")
        elapsed_ms = max(0, int((_time.time() - ticket["ts"]) * 1000))
        try:
            verify_human(elapsed_ms, request.data.get("pointer_path"))
        except NotHuman as exc:
            return _bad_request(exc.reason)
        try:
            value = _guess_from(request.data)
        except (TypeError, ValueError):
            return _bad_request("Invalid guess geometry.")
        pairing = Pairing.objects.select_related("thing", "scale").filter(pk=ticket["p"]).first()
        if pairing is None:
            return _bad_request("That pairing no longer exists.")
        score_and_record(player, pairing, value, elapsed_ms)  # counts like any round

    try:
        match = pvp.create_match(player, invited_email=invited_email)
    except pvp.PvpError as exc:
        return _bad_request(str(exc))

    link = f"{settings.PUBLIC_BASE_URL}/?pvp={match.join_code}"
    if mode == "email":
        try:
            send_pvp_invite(invited_email, match.join_code, challenger_email)
        except Exception:  # noqa: BLE001 — SMTP failure shouldn't lose the match
            return Response(
                {
                    "join_code": match.join_code,
                    "link": link,
                    "invited": False,
                    "detail": "Couldn't send the invite email — share the link instead.",
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )

    return Response(
        {"join_code": match.join_code, "link": link, "invited": mode == "email"}
    )


@extend_schema(responses={200: OpenApiTypes.OBJECT})
@api_view(["GET"])
def pvp_match(request, join_code: str) -> Response:
    """The caller's view of a match; the first new player to open it joins it."""
    player, denied = _player_gate(request)
    if denied is not None:
        return denied
    match = _match_or_404(join_code)
    if match is None:
        return _bad_request("That battle link is not valid.")
    if not match.has_player(player):
        try:
            match = pvp.join_match(player, join_code)
        except pvp.PvpError as exc:
            return _bad_request(str(exc))
    return Response(_state_with_token(match, player))


@extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
@api_view(["POST"])
def pvp_ready(request, join_code: str) -> Response:
    """Mark ready for a slot and wait (long-poll) for the other player.

    Returns the slot's deal once both are in; ``{"waiting": true}`` on timeout so
    the client can poll again immediately.
    """
    player, denied = _player_gate(request)
    if denied is not None:
        return denied
    match = _match_or_404(join_code)
    if match is None or not match.has_player(player):
        return _bad_request("That battle link is not valid.")
    try:
        index = int(request.data.get("index"))
    except (TypeError, ValueError):
        return _bad_request("Which round?")

    try:
        row = pvp.mark_ready(match, player, index)
    except pvp.PvpError as exc:
        return _bad_request(str(exc))

    if row.started_at is None:
        row = pvp.wait_for_start(match, index) or row
    if row.started_at is None:
        return Response({"waiting": True, "index": index, "opponent_joined": match.is_full})

    return Response({"waiting": False, "index": index, **_state_with_token(match, player)})


@extend_schema(request=OpenApiTypes.OBJECT, responses={200: OpenApiTypes.OBJECT})
@api_view(["POST"])
def pvp_guess(request, join_code: str) -> Response:
    """Answer the current slot; returns the reveal plus the updated match state."""
    player, denied = _player_gate(request)
    if denied is not None:
        return denied
    match = _match_or_404(join_code)
    if match is None or not match.has_player(player):
        return _bad_request("That battle link is not valid.")

    try:
        ticket = signing.loads(
            str(request.data.get("pvp_token", "")), salt=_SLOT_SALT, max_age=ROUND_TOKEN_MAX_AGE
        )
    except signing.BadSignature:
        return _bad_request("That round expired. Get the next one.")
    if ticket["u"] != player.pk or ticket["m"] != match.pk:
        return _bad_request("That round was dealt to a different player.")

    try:
        value = _guess_from(request.data)
    except (TypeError, ValueError):
        return _bad_request("Invalid guess geometry.")

    try:
        body, _entry = pvp.record_match_guess(match, player, int(ticket["i"]), value)
    except pvp.PvpError as exc:
        return _bad_request(str(exc))

    match.refresh_from_db()
    body["match"] = _state_with_token(match, player)
    return Response(body)


def issue_slot_token(match: PvpMatch, player, index: int) -> str:
    """Sign a ticket binding a match slot to a player (mirrors the round token)."""
    return signing.dumps(
        {"m": match.pk, "u": player.pk, "i": index, "ts": timezone.now().timestamp()},
        salt=_SLOT_SALT,
    )

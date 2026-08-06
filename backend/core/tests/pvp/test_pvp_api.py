"""The PvP API: level gate, invites (link + email), the barrier, and answering.

Executable spec:
- PvP is level-gated (``MULTIPLAYER_LEVEL``, default 4);
- a share link works for anyone; an email invite additionally needs the
  challenger's *own* claimed email plus a solved captcha round;
- the captcha is a real, counted round — and refuses instant/robotic input;
- a slot's question is withheld until both players are ready (blind guarantee);
- answering needs a signed slot token issued after the barrier released.
"""

import time

import pytest
from django.contrib.auth import get_user_model
from django.core import mail, signing
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APIClient

from core.models import Guess, Pairing, Player, PvpMatch, Scale, Thing
from core.services import recompute_snapshot

pytestmark = pytest.mark.django_db

CAPTCHA_URL = "/api/pvp/captcha/"
START_URL = "/api/pvp/start/"


def _graduated_pairing(index: int) -> Pairing:
    thing = Thing.objects.create(text=f"Thing {index}", slug=f"thing-{index}")
    scale = Scale.objects.create(
        left_label=f"l{index}", right_label=f"r{index}", slug=f"scale-{index}"
    )
    pairing = Pairing.objects.create(thing=thing, scale=scale)
    crowd = Player.objects.create(device_token=f"tok-crowd-{index}")
    for center in [40, 45, 48, 50, 50, 52, 55, 58, 60, 50, 47, 53, 49, 51, 50]:
        Guess.objects.create(
            pairing=pairing, player=crowd, center=float(center),
            width_left=10, width_right=10, response_ms=4000,
        )
    recompute_snapshot(pairing)
    return pairing


def _pool(n: int = 12) -> list[Pairing]:
    return [_graduated_pairing(i) for i in range(n)]


def _session(client: APIClient, *, level: int = 9) -> Player:
    assert client.post("/api/session/").status_code == status.HTTP_200_OK
    player = Player.objects.latest("created_at")
    player.level = level
    player.xp = 600_000
    player.save(update_fields=["level", "xp"])
    return player


def _claim(player: Player, email: str) -> None:
    player.user = get_user_model().objects.create(username=email, email=email)
    player.save(update_fields=["user"])


def _human_path() -> list[list[float]]:
    jitter = [0, 3, -2, 5, -1, 4, 2, -3, 6, 1, -4, 2]
    points, x, y, t = [], 0.0, 0.0, 0.0
    for i in range(24):
        x += 12 + jitter[i % len(jitter)]
        y += jitter[(i + 5) % len(jitter)]
        t += 16 + (jitter[(i + 3) % len(jitter)] % 11)
        points.append([x, y, t])
    return points


def _aged_captcha_token(player: Player, pairing: Pairing, seconds: float = 6.0) -> str:
    """A captcha ticket issued `seconds` ago, so the answer reads as unhurried."""
    return signing.dumps(
        {"p": pairing.pk, "u": player.pk, "ts": time.time() - seconds},
        salt="hivescale.pvp-captcha",
    )


# --- Level gate ------------------------------------------------------------


def test_pvp_is_level_gated() -> None:
    _pool()
    client = APIClient()
    _session(client, level=1)
    assert client.post(START_URL, {"mode": "link"}).status_code == status.HTTP_403_FORBIDDEN
    assert client.get(CAPTCHA_URL).status_code == status.HTTP_403_FORBIDDEN


def test_pvp_needs_a_session() -> None:
    assert APIClient().post(START_URL, {"mode": "link"}).status_code == status.HTTP_401_UNAUTHORIZED


@override_settings(MULTIPLAYER_LEVEL=4)
def test_level_four_unlocks_it_by_default() -> None:
    _pool()
    client = APIClient()
    _session(client, level=4)
    assert client.post(START_URL, {"mode": "link"}).status_code == status.HTTP_200_OK


# --- The share-link invite (privacy-friendly path) -------------------------


def test_a_link_invite_needs_no_email_at_all() -> None:
    _pool()
    client = APIClient()
    _session(client)
    response = client.post(START_URL, {"mode": "link"})
    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["invited"] is False
    assert body["join_code"] in body["link"]
    assert len(mail.outbox) == 0  # nothing sent, nothing disclosed


def test_the_first_stranger_to_open_the_link_becomes_the_opponent() -> None:
    _pool()
    host = APIClient()
    _session(host)
    code = host.post(START_URL, {"mode": "link"}).json()["join_code"]

    guest = APIClient()
    guest_player = _session(guest)
    state = guest.get(f"/api/pvp/{code}/")
    assert state.status_code == status.HTTP_200_OK
    assert state.json()["opponent_joined"] is True
    assert PvpMatch.objects.get(join_code=code).opponent_id == guest_player.pk

    # A third player is turned away.
    third = APIClient()
    _session(third)
    assert third.get(f"/api/pvp/{code}/").status_code == status.HTTP_400_BAD_REQUEST


# --- The email invite (needs a claimed account + a solved captcha) ---------


def test_email_invites_need_the_challenger_to_have_claimed_their_own_account() -> None:
    _pool()
    client = APIClient()
    _session(client)  # anonymous: no email of their own
    response = client.post(START_URL, {"mode": "email", "email": "friend@example.com"})
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert "email" in response.json()["detail"].lower()
    assert len(mail.outbox) == 0


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    PUBLIC_BASE_URL="https://play.example",
    DEFAULT_FROM_EMAIL="HiveScale <noreply@play.example>",
)
def test_a_solved_captcha_sends_the_invite_and_counts_as_a_real_round() -> None:
    pool = _pool()
    client = APIClient()
    player = _session(client)
    _claim(player, "me@example.com")

    dealt = client.get(CAPTCHA_URL)
    assert dealt.status_code == status.HTTP_200_OK
    assert dealt.json()["thing"]["text"]  # a real question to answer

    guesses_before = Guess.objects.filter(player=player).count()
    response = client.post(
        START_URL,
        {
            "mode": "email",
            "email": "friend@example.com",
            "captcha_token": _aged_captcha_token(player, pool[0]),
            "center": 50.0,
            "width_left": 12.0,
            "width_right": 12.0,
            "pointer_path": _human_path(),
        },
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK
    assert response.json()["invited"] is True

    # The captcha round really entered the dataset.
    assert Guess.objects.filter(player=player).count() == guesses_before + 1

    assert len(mail.outbox) == 1
    message = mail.outbox[0]
    assert message.to == ["friend@example.com"]
    assert "me@example.com" in message.subject  # who challenged them
    assert f"pvp={response.json()['join_code']}" in message.body
    assert "claim=" in message.body  # the link also saves their account


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_an_instant_captcha_answer_sends_nothing() -> None:
    pool = _pool()
    client = APIClient()
    player = _session(client)
    _claim(player, "me@example.com")

    response = client.post(
        START_URL,
        {
            "mode": "email",
            "email": "friend@example.com",
            # Issued 0.2s ago: far too quick to have read the question.
            "captcha_token": _aged_captcha_token(player, pool[0], seconds=0.2),
            "center": 50.0, "width_left": 12.0, "width_right": 12.0,
            "pointer_path": _human_path(),
        },
        format="json",
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "quick" in response.json()["detail"].lower()
    assert len(mail.outbox) == 0


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_robotic_pointer_movement_sends_nothing() -> None:
    pool = _pool()
    client = APIClient()
    player = _session(client)
    _claim(player, "me@example.com")

    response = client.post(
        START_URL,
        {
            "mode": "email",
            "email": "friend@example.com",
            "captcha_token": _aged_captcha_token(player, pool[0]),
            "center": 50.0, "width_left": 12.0, "width_right": 12.0,
            # Perfectly uniform deltas and frame gaps.
            "pointer_path": [[i * 15, i * 15, i * 16] for i in range(20)],
        },
        format="json",
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert len(mail.outbox) == 0


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_a_bad_friend_address_sends_nothing() -> None:
    _pool()
    client = APIClient()
    player = _session(client)
    _claim(player, "me@example.com")
    response = client.post(START_URL, {"mode": "email", "email": "not-an-email"})
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert len(mail.outbox) == 0


# --- Playing ---------------------------------------------------------------


def _pair_of_players() -> tuple[APIClient, APIClient, str]:
    _pool()
    host, guest = APIClient(), APIClient()
    _session(host)
    _session(guest)
    code = host.post(START_URL, {"mode": "link"}).json()["join_code"]
    guest.get(f"/api/pvp/{code}/")  # joins
    return host, guest, code


def test_the_question_is_withheld_until_both_players_are_ready() -> None:
    host, guest, code = _pair_of_players()

    waiting = host.get(f"/api/pvp/{code}/").json()["next"]
    assert waiting["started"] is False
    assert "thing" not in waiting  # blind until the barrier releases
    assert "pvp_token" not in waiting  # and unanswerable

    # One player alone only gets "still waiting".
    alone = host.post(f"/api/pvp/{code}/ready/", {"index": 0}, format="json")
    assert alone.status_code == status.HTTP_200_OK
    assert alone.json()["waiting"] is True

    # The second arrival releases it for both.
    both = guest.post(f"/api/pvp/{code}/ready/", {"index": 0}, format="json")
    assert both.json()["waiting"] is False
    assert both.json()["next"]["thing"]["text"]
    assert both.json()["next"]["pvp_token"]


def test_answering_a_slot_scores_it_and_reports_the_duel() -> None:
    host, guest, code = _pair_of_players()
    host.post(f"/api/pvp/{code}/ready/", {"index": 0}, format="json")
    ready = guest.post(f"/api/pvp/{code}/ready/", {"index": 0}, format="json").json()
    token = ready["next"]["pvp_token"]

    response = guest.post(
        f"/api/pvp/{code}/guess/",
        {"pvp_token": token, "center": 50.0, "width_left": 12.0, "width_right": 12.0},
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["source"] == "human"  # always rated — never a pioneer round
    assert body["speed_bonus"] is False  # no race won yet on round 0
    assert body["match"]["you"]["answered"] == 1
    assert body["match"]["opponent"]["answered"] == 0  # you answered first


def test_a_slot_token_is_not_transferable_between_players() -> None:
    host, guest, code = _pair_of_players()
    host.post(f"/api/pvp/{code}/ready/", {"index": 0}, format="json")
    ready = guest.post(f"/api/pvp/{code}/ready/", {"index": 0}, format="json").json()
    stolen = ready["next"]["pvp_token"]

    response = host.post(
        f"/api/pvp/{code}/guess/",
        {"pvp_token": stolen, "center": 50.0, "width_left": 12.0, "width_right": 12.0},
        format="json",
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_a_garbage_token_is_refused() -> None:
    host, _guest, code = _pair_of_players()
    response = host.post(
        f"/api/pvp/{code}/guess/",
        {"pvp_token": "junk", "center": 50.0, "width_left": 12.0, "width_right": 12.0},
        format="json",
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_an_unknown_match_code_is_refused() -> None:
    client = APIClient()
    _session(client)
    assert client.get("/api/pvp/nope/").status_code == status.HTTP_400_BAD_REQUEST


def test_multiplayer_shows_up_in_the_unlocks() -> None:
    _pool()
    client = APIClient()
    _session(client, level=9)
    unlocks = client.get("/api/me/").json()["unlocks"]
    assert unlocks["multiplayer"] is True

"""WP-04 red tests: anonymous sessions & players.

Executable spec (docs/baseline-guesser-plan.md, WP-04):
- new device -> new player; same token -> same player
- tokens are signed and httpOnly-cookie based; the raw token never appears in
  a response body
- no PII is stored for anonymous players (email enters only at claim time,
  and only on the auth User)
- claiming merges history into an existing claimed player and invalidates the
  anonymous token
"""

import pytest
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APIClient

from core.models import Guess, Pairing, Player, Scale, Thing
from core.sessions import SESSION_COOKIE_NAME

pytestmark = pytest.mark.django_db

SESSION_URL = "/api/session/"
ME_URL = "/api/me/"
CLAIM_REQUEST_URL = "/api/session/claim/request/"
CLAIM_CONFIRM_URL = "/api/session/claim/confirm/"


def _start_session(client: APIClient) -> dict:
    response = client.post(SESSION_URL)
    assert response.status_code == status.HTTP_200_OK
    return response.json()


def _claim(client: APIClient, email: str) -> dict:
    requested = client.post(CLAIM_REQUEST_URL, {"email": email})
    assert requested.status_code == status.HTTP_200_OK
    claim_token = requested.json()["claim_token"]  # echo delivery in dev/tests
    confirmed = client.post(CLAIM_CONFIRM_URL, {"claim_token": claim_token})
    assert confirmed.status_code == status.HTTP_200_OK
    return confirmed.json()


# ---------------------------------------------------------------------------
# Anonymous sessions
# ---------------------------------------------------------------------------


def test_new_device_gets_a_new_player_and_an_httponly_cookie() -> None:
    client = APIClient()
    body = _start_session(client)

    assert Player.objects.count() == 1
    assert body["player"] == {"level": 1, "xp": 0, "is_claimed": False}
    assert body["created"] is True

    cookie = client.cookies[SESSION_COOKIE_NAME]
    assert cookie["httponly"]
    assert cookie["samesite"] == "Lax"
    # The signed token lives in the cookie only — never in the body.
    assert cookie.value not in str(body)
    assert Player.objects.get().device_token not in str(body)
    assert cookie.value != Player.objects.get().device_token  # signed, not raw


def test_same_cookie_resolves_to_the_same_player() -> None:
    client = APIClient()
    _start_session(client)
    body = _start_session(client)
    assert Player.objects.count() == 1
    assert body["created"] is False


def test_tampered_cookie_starts_a_fresh_session_instead_of_crashing() -> None:
    client = APIClient()
    _start_session(client)
    client.cookies[SESSION_COOKIE_NAME] = "forged:value"
    body = _start_session(client)
    assert body["created"] is True
    assert Player.objects.count() == 2


def test_me_requires_a_session() -> None:
    assert APIClient().get(ME_URL).status_code == status.HTTP_401_UNAUTHORIZED


def test_me_returns_the_current_player_profile() -> None:
    client = APIClient()
    _start_session(client)
    Player.objects.update(level=4, xp=1234)
    body = client.get(ME_URL).json()
    assert body == {"level": 4, "xp": 1234, "is_claimed": False}


def test_anonymous_players_store_no_pii() -> None:
    client = APIClient()
    _start_session(client)
    field_names = {f.name for f in Player._meta.get_fields()}
    assert "email" not in field_names
    assert get_user_model().objects.count() == 0  # no auth user until claim


# ---------------------------------------------------------------------------
# Claiming (magic-link stub, echo delivery in dev)
# ---------------------------------------------------------------------------


def test_claim_request_requires_a_session_and_a_valid_email() -> None:
    assert (
        APIClient().post(CLAIM_REQUEST_URL, {"email": "a@b.example"}).status_code
        == status.HTTP_401_UNAUTHORIZED
    )
    client = APIClient()
    _start_session(client)
    response = client.post(CLAIM_REQUEST_URL, {"email": "not-an-email"})
    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_claim_confirm_rejects_garbage_tokens() -> None:
    client = APIClient()
    _start_session(client)
    response = client.post(CLAIM_CONFIRM_URL, {"claim_token": "junk"})
    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_first_claim_links_a_user_and_rotates_the_token() -> None:
    client = APIClient()
    _start_session(client)
    old_cookie = client.cookies[SESSION_COOKIE_NAME].value
    old_raw_token = Player.objects.get().device_token

    body = _claim(client, "wave@example.com")

    player = Player.objects.get()
    assert body["player"]["is_claimed"] is True
    assert body["merged"] is False
    assert player.user is not None and player.user.email == "wave@example.com"
    assert player.device_token != old_raw_token  # rotated on claim

    # The pre-claim cookie no longer resolves to anyone.
    stale = APIClient()
    stale.cookies[SESSION_COOKIE_NAME] = old_cookie
    assert stale.get(ME_URL).status_code == status.HTTP_401_UNAUTHORIZED

    # The rotated cookie works.
    assert client.get(ME_URL).status_code == status.HTTP_200_OK


def test_claiming_on_a_second_device_merges_history_into_the_claimed_player() -> None:
    # Device A: play a little, then claim.
    device_a = APIClient()
    _start_session(device_a)
    Player.objects.update(xp=500, level=3, calibration_stats={"n": 5, "hits": 4, "total_width": 60})
    _claim(device_a, "wave@example.com")
    claimed = Player.objects.get()

    # Device B: anonymous progress on the same human.
    device_b = APIClient()
    _start_session(device_b)
    anonymous = Player.objects.exclude(pk=claimed.pk).get()
    Player.objects.filter(pk=anonymous.pk).update(
        xp=200, level=2, calibration_stats={"n": 2, "hits": 1, "total_width": 30}
    )
    thing = Thing.objects.create(text="Fax machine", slug="fax-machine")
    scale = Scale.objects.create(left_label="timeless", right_label="obsolete", slug="t-o")
    pairing = Pairing.objects.create(thing=thing, scale=scale)
    for center in (70.0, 80.0):
        Guess.objects.create(
            pairing=pairing, player=anonymous, center=center,
            width_left=5, width_right=5, response_ms=4000,
        )
    old_b_cookie = device_b.cookies[SESSION_COOKIE_NAME].value

    body = _claim(device_b, "wave@example.com")

    assert body["merged"] is True
    assert Player.objects.count() == 1  # anonymous player is gone
    claimed.refresh_from_db()
    assert claimed.xp == 700
    assert claimed.level == 3  # keeps the best
    assert claimed.calibration_stats == {"n": 7, "hits": 5, "total_width": 90.0}
    assert set(claimed.guesses.values_list("center", flat=True)) == {70.0, 80.0}

    # Device B's anonymous token is invalidated; its new cookie is the claimed one.
    stale = APIClient()
    stale.cookies[SESSION_COOKIE_NAME] = old_b_cookie
    assert stale.get(ME_URL).status_code == status.HTTP_401_UNAUTHORIZED
    assert device_b.get(ME_URL).json()["xp"] == 700

    # Exactly one auth user for the email, case-insensitively.
    users = get_user_model().objects.all()
    assert users.count() == 1 and users.get().email == "wave@example.com"


def test_claim_email_is_case_insensitive_for_merging() -> None:
    device_a = APIClient()
    _start_session(device_a)
    _claim(device_a, "Wave@Example.com")
    device_b = APIClient()
    _start_session(device_b)
    _claim(device_b, "wave@example.COM")
    assert get_user_model().objects.count() == 1
    assert Player.objects.count() == 1

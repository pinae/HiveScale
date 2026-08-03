"""Player-authored scales (plan §2.x, unlocked at level 15).

Executable spec:
- level-gated, offered at most once a day and only after ``min_rounds`` rounds;
- ``GET /api/scale-request/`` picks a thing and lists its existing scales (what
  not to repeat) with a signed token; ``POST`` files a DRAFT scale, pairs it with
  the thing, and marks the day so no second request is offered.
"""

import datetime

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from core import scale_requests
from core.models import ContentStatus, Guess, Pairing, Player, Scale, Thing

pytestmark = pytest.mark.django_db

GET_URL = "/api/scale-request/"
POST_URL = "/api/scale-request/submit/"


def _leveled_session(client: APIClient, level: int = 15) -> Player:
    assert client.post("/api/session/").status_code == status.HTTP_200_OK
    player = Player.objects.latest("created_at")
    Player.objects.filter(pk=player.pk).update(level=level)
    player.refresh_from_db()
    return player


def _thing(i: int = 0) -> Thing:
    return Thing.objects.create(text=f"Thing {i}", slug=f"thing-{i}")


def _play_rounds(player: Player, n: int) -> None:
    """Give the player n rounds today so the scale request is offered."""
    pairing = Pairing.objects.create(thing=_thing(99), scale=_make_scale(99))
    for _ in range(n):
        Guess.objects.create(
            pairing=pairing, player=player, center=50, width_left=10, width_right=10,
            response_ms=4000,
        )


def _make_scale(i: int) -> Scale:
    return Scale.objects.create(left_label=f"l{i}", right_label=f"r{i}", slug=f"scale-{i}")


def test_scale_requests_are_level_gated() -> None:
    client = APIClient()
    _leveled_session(client, level=14)
    assert client.get(GET_URL).status_code == status.HTTP_403_FORBIDDEN


def test_not_offered_until_enough_rounds_today() -> None:
    _thing()
    client = APIClient()
    player = _leveled_session(client)
    _play_rounds(player, scale_requests.min_rounds() - 1)
    body = client.get(GET_URL).json()
    assert body["available"] is False
    assert "rounds today" in body["reason"]


def test_offered_after_enough_rounds_with_examples_and_token() -> None:
    thing = _thing()
    # Give the thing two existing scales so they show up as examples.
    for i in range(2):
        Pairing.objects.create(thing=thing, scale=_make_scale(i), n_answers=i)
    client = APIClient()
    player = _leveled_session(client)
    _play_rounds(player, scale_requests.min_rounds())

    body = client.get(GET_URL).json()
    assert body["available"] is True
    assert body["thing"]["text"].startswith("Thing")
    assert body["scale_request_token"]
    assert all(set(e.keys()) == {"left", "right"} for e in body["examples"])


def test_submitting_files_a_draft_scale_paired_with_the_thing_once_a_day() -> None:
    _thing()
    client = APIClient()
    player = _leveled_session(client)
    _play_rounds(player, scale_requests.min_rounds())
    deal = client.get(GET_URL).json()
    token = deal["scale_request_token"]
    prompt_thing_id = deal["thing"]["id"]

    body = client.post(
        POST_URL, {"scale_request_token": token, "left": "cosmic", "right": "mundane"}
    ).json()

    scale = Scale.objects.get(pk=body["scale_id"])
    assert scale.status == ContentStatus.DRAFT
    assert scale.created_by_id == player.pk
    # Paired with the very thing the prompt named.
    assert Pairing.objects.filter(thing_id=prompt_thing_id, scale=scale).exists()
    player.refresh_from_db()
    assert player.last_scale_request_on == datetime.date.today()

    # A second request the same day is refused.
    assert client.get(GET_URL).json()["available"] is False
    assert client.post(
        POST_URL, {"scale_request_token": token, "left": "a", "right": "b"}
    ).status_code == status.HTTP_400_BAD_REQUEST

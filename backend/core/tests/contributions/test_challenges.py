"""Thing challenges (plan §2.x, unlocked at level 10).

Executable spec:
- challenges are level-gated;
- ``GET /api/challenge/next/`` deals two scales + a signed token;
- a valid ≤3-word answer creates a DRAFT Thing, banks the flat bonus (10 normal
  rounds at ×5 = 25,000 XP), and re-levels; over-long or foreign-token answers
  are rejected.
"""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from core import challenges
from core.models import ContentStatus, Player, Scale, Thing

pytestmark = pytest.mark.django_db

NEXT_URL = "/api/challenge/next/"
SUBMIT_URL = "/api/challenge/"


def _leveled_session(client: APIClient, level: int = 10) -> Player:
    assert client.post("/api/session/").status_code == status.HTTP_200_OK
    player = Player.objects.latest("created_at")
    Player.objects.filter(pk=player.pk).update(level=level)
    player.refresh_from_db()
    return player


def _scales(n: int = 3) -> None:
    for i in range(n):
        Scale.objects.create(left_label=f"l{i}", right_label=f"r{i}", slug=f"scale-{i}")


def test_reward_is_ten_normal_rounds_at_times_five() -> None:
    assert challenges.CHALLENGE_XP == 10 * 500 * 5 == 25_000


def test_challenges_are_level_gated() -> None:
    _scales()
    client = APIClient()
    _leveled_session(client, level=9)
    assert client.get(NEXT_URL).status_code == status.HTTP_403_FORBIDDEN


def test_next_deals_two_scales_and_a_token() -> None:
    _scales()
    client = APIClient()
    _leveled_session(client)
    body = client.get(NEXT_URL).json()
    assert set(body["first_scale"].keys()) == {"id", "left", "right"}
    assert body["first_scale"]["id"] != body["second_scale"]["id"]
    assert body["max_words"] == 3
    assert body["reward_xp"] == challenges.CHALLENGE_XP
    assert body["challenge_token"]


def test_a_valid_answer_creates_a_thing_and_banks_the_bonus() -> None:
    _scales()
    client = APIClient()
    player = _leveled_session(client)
    token = client.get(NEXT_URL).json()["challenge_token"]

    body = client.post(SUBMIT_URL, {"challenge_token": token, "text": "sentient toaster"}).json()

    thing = Thing.objects.get(pk=body["thing_id"])
    assert thing.text == "sentient toaster"
    assert thing.status == ContentStatus.DRAFT
    assert thing.created_by_id == player.pk
    assert body["xp_awarded"] == challenges.CHALLENGE_XP
    player.refresh_from_db()
    assert player.xp == challenges.CHALLENGE_XP
    assert body["player"]["level"] == player.level


def test_more_than_three_words_is_rejected() -> None:
    _scales()
    client = APIClient()
    _leveled_session(client)
    token = client.get(NEXT_URL).json()["challenge_token"]
    resp = client.post(SUBMIT_URL, {"challenge_token": token, "text": "one two three four"})
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert not Thing.objects.exists()


def test_a_token_from_another_player_is_rejected() -> None:
    _scales()
    client_a, client_b = APIClient(), APIClient()
    _leveled_session(client_a)
    _leveled_session(client_b)
    stolen = client_a.get(NEXT_URL).json()["challenge_token"]
    resp = client_b.post(SUBMIT_URL, {"challenge_token": stolen, "text": "quiet volcano"})
    assert resp.status_code == status.HTTP_400_BAD_REQUEST

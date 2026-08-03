"""Pairing voting (plan §2.x, unlocked at level 5).

Executable spec:
- voting is level-gated; a fun/interesting vote on a *candidate* combo creates a
  real pairing; a candidate voted boring/weird is just noted;
- an existing pairing that reaches ≥80% negative (with enough votes) is retired
  and flagged (never suggested or played again); admins can disable voting;
- ``GET /api/vote/next/`` serves a thing+scale to judge, never a paired combo as
  a "candidate".
"""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from core import voting
from core.models import ContentStatus, Pairing, PairingVote, Player, Scale, Thing

pytestmark = pytest.mark.django_db

NEXT_URL = "/api/vote/next/"
VOTE_URL = "/api/vote/"


def _leveled_session(client: APIClient, level: int = 5) -> Player:
    assert client.post("/api/session/").status_code == status.HTTP_200_OK
    player = Player.objects.latest("created_at")
    Player.objects.filter(pk=player.pk).update(level=level)
    player.refresh_from_db()
    return player


def _thing(i: int) -> Thing:
    return Thing.objects.create(text=f"Thing {i}", slug=f"thing-{i}")


def _scale(i: int) -> Scale:
    return Scale.objects.create(left_label=f"l{i}", right_label=f"r{i}", slug=f"scale-{i}")


def test_voting_is_level_gated() -> None:
    thing, scale = _thing(1), _scale(1)
    client = APIClient()
    _leveled_session(client, level=4)  # one below the gate
    assert client.get(NEXT_URL).status_code == status.HTTP_403_FORBIDDEN
    resp = client.post(VOTE_URL, {"thing_id": thing.pk, "scale_id": scale.pk, "choice": "fun"})
    assert resp.status_code == status.HTTP_403_FORBIDDEN


def test_a_positive_vote_promotes_a_candidate_to_a_real_pairing() -> None:
    thing, scale = _thing(1), _scale(1)
    client = APIClient()
    _leveled_session(client)
    body = client.post(
        VOTE_URL, {"thing_id": thing.pk, "scale_id": scale.pk, "choice": "interesting"}
    ).json()
    assert body["outcome"] == "added"
    pairing = Pairing.objects.get(pk=body["pairing_id"])
    assert pairing.thing == thing and pairing.scale == scale
    assert pairing.status == ContentStatus.ACTIVE


def test_a_negative_vote_on_a_candidate_creates_no_pairing() -> None:
    thing, scale = _thing(1), _scale(1)
    client = APIClient()
    _leveled_session(client)
    body = client.post(
        VOTE_URL, {"thing_id": thing.pk, "scale_id": scale.pk, "choice": "boring"}
    ).json()
    assert body["outcome"] == "noted"
    assert not Pairing.objects.filter(thing=thing, scale=scale).exists()
    assert PairingVote.objects.count() == 1


def test_a_disliked_existing_pairing_is_retired_and_never_suggested_again() -> None:
    thing, scale = _thing(1), _scale(1)
    pairing = Pairing.objects.create(thing=thing, scale=scale, status=ContentStatus.ACTIVE)
    # Five votes, ≥80% negative: 4 boring + 1 fun.
    result = {}
    for i, choice in enumerate(["boring", "weird", "boring", "weird", "fun"]):
        voter = Player.objects.create(device_token=f"voter-{i}")
        result = voting.record_vote(voter, thing, scale, choice)
    assert result["outcome"] == "retired"
    pairing.refresh_from_db()
    assert pairing.status == ContentStatus.REJECTED
    assert pairing.voting_disabled is True
    # A rejected combo is not offered as a fresh candidate.
    assert voting.random_candidate() is None


def test_admin_disabled_pairings_are_never_served_for_voting() -> None:
    thing, scale = _thing(1), _scale(1)
    Pairing.objects.create(
        thing=thing, scale=scale, status=ContentStatus.ACTIVE, voting_disabled=True
    )
    assert voting.random_existing() is None


def test_next_vote_returns_a_thing_and_scale_to_judge() -> None:
    _thing(1), _scale(1)
    client = APIClient()
    _leveled_session(client)
    body = client.get(NEXT_URL).json()
    assert set(body["thing"].keys()) == {"id", "text"}
    assert set(body["scale"].keys()) == {"id", "left", "right"}
    assert "existing" in body

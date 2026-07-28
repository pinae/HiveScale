"""WP-11/12: the Daily Wave play API (plan §2.2 / §3.3).

Executable spec:
- ``GET /api/daily-wave/`` needs a session, lazily builds today's wave, and
  returns the player's progress plus the next *blind* slot (no distribution);
- ``POST /api/daily-wave/guess/`` scores a slot with the shared round scorer,
  advances progress, and refuses replays / other players' tokens;
- answering every slot completes the wave and yields the share string;
- the wave is identical for everyone on a date.
"""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from core.daily_wave import grade_emoji
from core.models import DailyWave, DailyWaveEntry, Guess, Pairing, Player, Scale, Thing
from core.services import recompute_snapshot

pytestmark = pytest.mark.django_db

WAVE_URL = "/api/daily-wave/"
GUESS_URL = "/api/daily-wave/guess/"


def _session(client: APIClient) -> Player:
    assert client.post("/api/session/").status_code == status.HTTP_200_OK
    return Player.objects.latest("created_at")


def _answer(token: str, center: float = 50.0):
    return {"wave_token": token, "center": center, "width_left": 12.0, "width_right": 12.0}


def _make_pairings(n: int) -> list[Pairing]:
    pairings = []
    for i in range(n):
        thing = Thing.objects.create(text=f"Thing {i}", slug=f"thing-{i}")
        scale = Scale.objects.create(left_label=f"l{i}", right_label=f"r{i}", slug=f"scale-{i}")
        pairings.append(Pairing.objects.create(thing=thing, scale=scale))
    return pairings


def _graduate(pairing: Pairing) -> None:
    """Give a pairing a human baseline (median ~50, n=20) so slots score human."""
    crowd = Player.objects.create(device_token=f"crowd-{pairing.pk}")
    for center in [30, 40, 45, 47, 48, 50, 50, 50, 52, 53, 55, 60, 42, 46, 49, 51, 54, 58, 44, 56]:
        Guess.objects.create(
            pairing=pairing, player=crowd, center=float(center),
            width_left=10, width_right=10, response_ms=4000,
        )
    recompute_snapshot(pairing)


def _play_all(client: APIClient) -> dict:
    """Answer every slot of today's wave; return the last response body."""
    body = client.get(WAVE_URL).json()
    last = body
    while body["next"] is not None:
        last = client.post(GUESS_URL, _answer(body["next"]["wave_token"])).json()
        body = last["wave"]
    return last


def test_wave_requires_a_session() -> None:
    assert APIClient().get(WAVE_URL).status_code == status.HTTP_401_UNAUTHORIZED


def test_wave_is_lazily_generated_and_blind() -> None:
    _make_pairings(12)
    client = APIClient()
    _session(client)

    body = client.get(WAVE_URL).json()
    assert DailyWave.objects.count() == 1  # built on first read
    assert body["total"] == 10
    assert body["answered"] == 0
    assert body["completed"] is False
    # The next slot is a blind deal — identity only, never a distribution.
    assert set(body["next"].keys()) == {"index", "pairing_id", "thing", "scale", "wave_token"}
    assert "histogram" not in body["next"] and "median" not in body["next"]


def test_no_active_pairings_is_a_clean_404() -> None:
    client = APIClient()
    _session(client)
    assert client.get(WAVE_URL).status_code == status.HTTP_404_NOT_FOUND


def test_answering_a_slot_advances_progress_and_reveals_the_crowd() -> None:
    for pairing in _make_pairings(10):
        _graduate(pairing)
    client = APIClient()
    _session(client)

    body = client.get(WAVE_URL).json()
    reveal = client.post(GUESS_URL, _answer(body["next"]["wave_token"])).json()

    assert reveal["source"] == "human"
    assert "crowd" in reveal  # the reveal still happens per slot
    wave = reveal["wave"]
    assert wave["answered"] == 1
    assert wave["completed"] is False
    assert wave["results"] == [grade_emoji(reveal["score"]["total"])]
    assert wave["next"]["index"] == 1  # advanced to the next slot


def test_a_slot_cannot_be_answered_twice() -> None:
    for pairing in _make_pairings(10):
        _graduate(pairing)
    client = APIClient()
    _session(client)
    payload = _answer(client.get(WAVE_URL).json()["next"]["wave_token"])

    assert client.post(GUESS_URL, payload).status_code == status.HTTP_200_OK
    assert client.post(GUESS_URL, payload).status_code == status.HTTP_400_BAD_REQUEST


def test_a_token_from_another_player_is_rejected() -> None:
    for pairing in _make_pairings(10):
        _graduate(pairing)
    client_a, client_b = APIClient(), APIClient()
    _session(client_a)
    _session(client_b)
    stolen = client_a.get(WAVE_URL).json()["next"]["wave_token"]
    assert client_b.post(GUESS_URL, _answer(stolen)).status_code == status.HTTP_400_BAD_REQUEST


def test_completing_the_wave_yields_the_share_string() -> None:
    for pairing in _make_pairings(10):
        _graduate(pairing)
    client = APIClient()
    player = _session(client)

    final = _play_all(client)["wave"]
    assert final["completed"] is True
    assert final["answered"] == 10
    assert final["next"] is None
    assert final["share_string"].startswith("HiveScale ")
    assert len(final["results"]) == 10
    assert DailyWaveEntry.objects.filter(player=player).count() == 10


def test_every_player_gets_the_same_wave_for_the_day() -> None:
    _make_pairings(14)
    client_a, client_b = APIClient(), APIClient()
    _session(client_a)
    _session(client_b)
    assert _wave_pairings(client_a) == _wave_pairings(client_b)


def _wave_pairings(client: APIClient) -> list[int]:
    """The persisted ordered pairing list behind the wave a player sees."""
    body = client.get(WAVE_URL).json()
    return DailyWave.objects.get(date=body["date"]).pairing_ids

"""WP-11: calibration archetypes and the /api/me/stats/ endpoint (plan §2.2)."""

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from core.archetypes import classify
from core.models import Player

pytestmark = pytest.mark.django_db


def _stats(n, hits, total_width):
    return {"n": n, "hits": hits, "total_width": total_width}


def test_newcomer_below_the_round_floor():
    assert classify(_stats(2, 1, 40))["name"] == "Newcomer"


def test_oracle_is_tight_and_well_calibrated():
    # 10 rounds, mean width 20 (tight), hit rate 0.7 (>= 0.5).
    assert classify(_stats(10, 7, 200))["name"] == "Oracle"


def test_diplomat_plays_wide():
    # mean width 60 (>= 40) dominates regardless of hit rate.
    assert classify(_stats(10, 9, 600))["name"] == "Diplomat"


def test_maverick_is_tight_but_contrarian():
    # tight (mean width 15) but low hit rate (0.2).
    assert classify(_stats(10, 2, 150))["name"] == "Maverick"


def test_stats_endpoint_requires_a_session():
    assert APIClient().get("/api/me/stats/").status_code == status.HTTP_401_UNAUTHORIZED


def test_stats_endpoint_returns_archetype_calibration_and_streaks():
    client = APIClient()
    assert client.post("/api/session/").status_code == 200
    player = Player.objects.latest("created_at")
    player.calibration_stats = _stats(10, 7, 200)
    player.hot_streak = 2
    player.daily_streak = 4
    player.streak_freezes = 1
    player.xp = 3200
    player.save()

    body = client.get("/api/me/stats/").json()
    assert body["archetype"]["name"] == "Oracle"
    assert "blurb" in body["archetype"]
    assert body["calibration"] == {"n": 10, "hit_rate": 0.7, "mean_width": 20.0}
    assert body["streaks"] == {"hot": 2, "daily": 4, "freezes": 1}
    assert body["xp"] == 3200

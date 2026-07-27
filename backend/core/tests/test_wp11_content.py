"""WP-11: level-gated content submission + LLM sanity check (plan §1.6)."""

import pytest
from rest_framework.test import APIClient

from core.ai import FakeGeminiClient
from core.content import run_sanity_check
from core.models import ContentStatus, Player, Scale, Thing

pytestmark = pytest.mark.django_db

THINGS_URL = "/api/content/things/"
SCALES_URL = "/api/content/scales/"


@pytest.fixture(autouse=True)
def _no_broker(monkeypatch):
    # The request path enqueues an async sanity check; don't touch a broker.
    monkeypatch.setattr("core.content_api.schedule_sanity_check", lambda *a, **k: True)


def _session(client: APIClient, level: int = 1) -> Player:
    assert client.post("/api/session/").status_code == 200
    player = Player.objects.latest("created_at")
    player.level = level
    player.save(update_fields=["level"])
    return player


# --- Gating -----------------------------------------------------------------


def test_submission_requires_a_session():
    assert APIClient().post(THINGS_URL, {"text": "x"}).status_code == 401


def test_low_level_players_are_gated_out():
    client = APIClient()
    _session(client, level=3)
    assert client.post(THINGS_URL, {"text": "Robotic lawnmower"}).status_code == 403
    assert client.post(SCALES_URL, {"left": "cheap", "right": "dear"}).status_code == 403


# --- Happy submissions ------------------------------------------------------


def test_high_level_player_can_submit_a_thing():
    client = APIClient()
    player = _session(client, level=10)
    res = client.post(THINGS_URL, {"text": "Robotic lawnmower"})
    assert res.status_code == 201
    thing = Thing.objects.get(pk=res.json()["id"])
    assert thing.status == ContentStatus.DRAFT  # held until vetted
    assert thing.created_by == player


def test_high_level_player_can_submit_a_scale():
    client = APIClient()
    _session(client, level=12)
    res = client.post(SCALES_URL, {"left": "sophisticated", "right": "overcomplicated"})
    assert res.status_code == 201
    assert Scale.objects.get(pk=res.json()["id"]).status == ContentStatus.DRAFT


# --- Filtering ---------------------------------------------------------------


def test_pii_is_blocked_before_anything_is_stored():
    client = APIClient()
    _session(client, level=10)
    res = client.post(THINGS_URL, {"text": "email me at spam@example.com"})
    assert res.status_code == 400
    assert Thing.objects.count() == 0


def test_empty_or_overlong_text_is_rejected():
    client = APIClient()
    _session(client, level=10)
    assert client.post(THINGS_URL, {"text": ""}).status_code == 400
    assert client.post(THINGS_URL, {"text": "x" * 200}).status_code == 400


# --- Sanity check verdicts ---------------------------------------------------


def _thing() -> Thing:
    return Thing.objects.create(text="Robotic lawnmower", slug="rl", status=ContentStatus.DRAFT)


def test_sanity_accept_publishes():
    obj = _thing()
    verdict = run_sanity_check(obj, FakeGeminiClient(['{"verdict": "accept", "reason": "known"}']))
    obj.refresh_from_db()
    assert verdict == "accept"
    assert obj.status == ContentStatus.ACTIVE


def test_sanity_queue_holds_for_a_moderator():
    obj = _thing()
    run_sanity_check(obj, FakeGeminiClient(['{"verdict": "queue", "reason": "unsure"}']))
    obj.refresh_from_db()
    assert obj.status == ContentStatus.DRAFT


def test_sanity_reject_marks_rejected():
    obj = _thing()
    run_sanity_check(obj, FakeGeminiClient(['{"verdict": "reject", "reason": "nonsense"}']))
    obj.refresh_from_db()
    assert obj.status == ContentStatus.REJECTED


def test_malformed_sanity_response_falls_back_to_the_queue():
    obj = _thing()
    verdict = run_sanity_check(obj, FakeGeminiClient(["not json"]))
    obj.refresh_from_db()
    assert verdict == "queue"
    assert obj.status == ContentStatus.DRAFT

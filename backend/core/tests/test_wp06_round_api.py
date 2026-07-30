"""WP-06 red tests: the round API (deal -> guess -> score -> reveal).

Executable spec (docs/hivescale-plan.md, WP-06 + §1.4/§1.5/§1.7):
- ``GET /api/round/next/`` deals a *blind* round bound to a signed round token;
- ``POST /api/round/guess/`` scores the guess and returns the reveal payload
  (crowd histogram, score breakdown, percentile, streak) or the pioneer payload;
- response time is measured server-side from the round token, so the speed
  floor cannot be gamed by a client-supplied number; too-fast answers are still
  revealed but earn no xp, no streak, and never touch the baseline;
- scoring uses the snapshot as it existed *before* the guess (you are never
  scored against yourself), and every ``RoundScore`` is reproducible from its
  stored inputs;
- the pioneer path pays a flat bonus while ``n < N_MIN`` and may surface a
  clearly-labeled provisional AI estimate; the 16th eligible answer flips the
  scoring source from pioneer to the human baseline;
- an OpenAPI schema is published at ``/api/schema/``.
"""

import time

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from bglib.scoring import Guess as GuessValue
from bglib.scoring import SnapshotStats, crps, guess_to_distribution, visible_score
from core import leveling
from core.models import (
    AIDistribution,
    DistributionSnapshot,
    Guess,
    Pairing,
    Player,
    RoundScore,
    Scale,
    Thing,
)
from core.round_api import GOOD_ROUND_THRESHOLD, PIONEER_BONUS, issue_round_token
from core.services import SPEED_FLOOR_MS, recompute_snapshot

pytestmark = pytest.mark.django_db

NEXT_URL = "/api/round/next/"
GUESS_URL = "/api/round/guess/"


def _session(client: APIClient) -> Player:
    assert client.post("/api/session/").status_code == status.HTTP_200_OK
    return Player.objects.latest("created_at")


def _make_pairing(index: int = 1) -> Pairing:
    thing = Thing.objects.create(text=f"Thing {index}", slug=f"thing-{index}")
    scale = Scale.objects.create(
        left_label=f"left {index}", right_label=f"right {index}", slug=f"scale-{index}"
    )
    return Pairing.objects.create(thing=thing, scale=scale)


def _graduated_pairing() -> Pairing:
    """A pairing with an established human baseline (median 50, n=20)."""
    pairing = _make_pairing()
    crowd = Player.objects.create(device_token="tok-crowd")
    centers = [30, 35, 40, 42, 45, 47, 48, 50, 50, 50,
               52, 53, 55, 58, 60, 65, 70, 45, 55, 50]
    for center in centers:
        Guess.objects.create(
            pairing=pairing, player=crowd, center=float(center),
            width_left=10, width_right=10, response_ms=4000,
        )
    recompute_snapshot(pairing)
    return pairing


def _slow_token(pairing: Pairing, player: Player) -> str:
    """A round token dealt 5 seconds ago -> the answer counts as unhurried."""
    return issue_round_token(pairing, player, issued_at=time.time() - 5.0)


def _submit(client: APIClient, token: str, center=50.0, wl=12.0, wr=12.0):
    return client.post(
        GUESS_URL,
        {"round_token": token, "center": center, "width_left": wl, "width_right": wr},
    )


# --- Dealing ---------------------------------------------------------------


def test_next_requires_a_session() -> None:
    assert APIClient().get(NEXT_URL).status_code == status.HTTP_401_UNAUTHORIZED


def test_next_deals_a_blind_round_with_a_token() -> None:
    _graduated_pairing()
    client = APIClient()
    _session(client)
    body = client.get(NEXT_URL).json()
    assert set(body.keys()) == {"round_token", "pairing_id", "thing", "scale"}
    assert body["thing"] == {"text": "Thing 1"}
    assert body["scale"] == {"left": "left 1", "right": "right 1"}


def test_next_with_an_empty_database_is_a_clean_404() -> None:
    client = APIClient()
    _session(client)
    assert client.get(NEXT_URL).status_code == status.HTTP_404_NOT_FOUND


def test_next_honors_the_client_exclude_list() -> None:
    # The frontend passes its recently-seen ids so the backend skips them.
    keep = _graduated_pairing()
    skip = _make_pairing(2)
    client = APIClient()
    _session(client)
    seen = {
        client.get(NEXT_URL, {"exclude": str(skip.pk)}).json()["pairing_id"]
        for _ in range(30)
    }
    assert seen == {keep.pk}


def test_next_ignores_junk_in_the_exclude_list() -> None:
    keep = _graduated_pairing()
    client = APIClient()
    _session(client)
    # Non-numeric junk is dropped rather than erroring; the deal still succeeds.
    body = client.get(NEXT_URL, {"exclude": "abc,,99999999,"}).json()
    assert body["pairing_id"] == keep.pk


# --- Submission guards ------------------------------------------------------


def test_guess_requires_a_session_and_a_valid_token() -> None:
    assert (
        APIClient().post(GUESS_URL, {"round_token": "x"}).status_code
        == status.HTTP_401_UNAUTHORIZED
    )
    client = APIClient()
    _session(client)
    assert _submit(client, "garbage").status_code == status.HTTP_400_BAD_REQUEST


def test_guess_rejects_a_token_issued_to_another_player() -> None:
    pairing = _graduated_pairing()
    client_a, client_b = APIClient(), APIClient()
    player_a = _session(client_a)
    _session(client_b)
    stolen = _slow_token(pairing, player_a)
    assert _submit(client_b, stolen).status_code == status.HTTP_400_BAD_REQUEST


def test_guess_rejects_invalid_geometry() -> None:
    pairing = _graduated_pairing()
    client = APIClient()
    player = _session(client)
    assert _submit(client, _slow_token(pairing, player), center=150).status_code == 400
    assert _submit(client, _slow_token(pairing, player), wl=-3).status_code == 400
    assert Guess.objects.filter(player=player).count() == 0  # nothing stored


# --- The human-baseline round-trip ------------------------------------------


def test_round_trip_reveal_payload_on_a_graduated_pairing() -> None:
    pairing = _graduated_pairing()
    snapshot = DistributionSnapshot.objects.latest("computed_at")
    client = APIClient()
    player = _session(client)

    response = _submit(
        client, _slow_token(pairing, player), center=snapshot.median, wl=15, wr=15
    )
    assert response.status_code == status.HTTP_200_OK
    body = response.json()

    assert body["source"] == "human"
    assert body["counted"] is True
    assert 0 <= body["score"]["total"] <= 1000
    assert body["score"]["total"] == pytest.approx(
        body["score"]["distance_points"] + body["score"]["calibration_points"]
    )
    assert len(body["crowd"]["histogram"]) == 20
    assert body["crowd"]["n"] == snapshot.n
    assert body["crowd"]["median"] == pytest.approx(snapshot.median)
    assert 0 <= body["percentile"] <= 100
    assert isinstance(body["bimodal"], bool)
    assert body["streak"]["hot"] == 1  # a median hit is a good round

    player.refresh_from_db()
    assert player.xp == int(round(body["score"]["total"]))

    guess = Guess.objects.get(player=player)
    assert guess.response_ms >= SPEED_FLOOR_MS  # measured server-side
    assert guess.quality_flags == []


def test_scoring_uses_the_snapshot_from_before_the_guess() -> None:
    pairing = _graduated_pairing()
    before = DistributionSnapshot.objects.latest("computed_at")
    client = APIClient()
    player = _session(client)

    body = _submit(client, _slow_token(pairing, player), center=0.0, wl=2, wr=2).json()

    score = RoundScore.objects.get(guess__player=player)
    assert score.components["snapshot_id"] == before.pk
    after = DistributionSnapshot.objects.latest("computed_at")
    assert after.pk != before.pk
    assert after.n == before.n + 1
    assert body["crowd"]["n"] == before.n  # reveal shows the pre-guess crowd


def test_round_scores_are_reproducible_from_stored_inputs() -> None:
    pairing = _graduated_pairing()
    client = APIClient()
    player = _session(client)
    _submit(client, _slow_token(pairing, player), center=61.0, wl=9.0, wr=17.0)

    stored = RoundScore.objects.get(guess__player=player)
    guess = stored.guess
    snapshot = DistributionSnapshot.objects.get(pk=stored.components["snapshot_id"])
    value = GuessValue(guess.center, guess.width_left, guess.width_right)
    recomputed = visible_score(
        value, SnapshotStats(median=snapshot.median, q25=snapshot.q25, q75=snapshot.q75)
    )
    assert stored.visible_points == pytest.approx(recomputed.total)
    assert stored.crps == pytest.approx(
        crps(guess_to_distribution(value), tuple(snapshot.histogram))
    )


def test_percentile_rewards_proximity_to_the_median() -> None:
    pairing = _graduated_pairing()
    snapshot = DistributionSnapshot.objects.latest("computed_at")
    near_client, far_client = APIClient(), APIClient()
    near = _session(near_client)
    far = _session(far_client)
    near_pct = _submit(
        near_client, _slow_token(pairing, near), center=snapshot.median
    ).json()["percentile"]
    far_pct = _submit(
        far_client, _slow_token(pairing, far), center=2.0
    ).json()["percentile"]
    assert near_pct > 75
    assert far_pct < 25


def test_too_fast_answers_are_flagged_scored_but_not_counted() -> None:
    pairing = _graduated_pairing()
    snapshot_n = DistributionSnapshot.objects.latest("computed_at").n
    client = APIClient()
    player = _session(client)

    token = issue_round_token(pairing, player)  # issued "now" -> instant answer
    body = _submit(client, token).json()

    assert body["counted"] is False
    assert "score" in body  # still fun: the reveal happens
    player.refresh_from_db()
    assert player.xp == 0  # ...but no farmable rewards
    assert body["streak"]["hot"] == 0
    assert Guess.objects.get(player=player).quality_flags == ["too_fast"]
    assert DistributionSnapshot.objects.latest("computed_at").n == snapshot_n


def test_hot_streak_builds_on_good_rounds_and_resets_on_bad_ones() -> None:
    pairing = _graduated_pairing()
    median = DistributionSnapshot.objects.latest("computed_at").median
    client = APIClient()
    player = _session(client)

    assert (
        _submit(client, _slow_token(pairing, player), center=median).json()["streak"]["hot"]
        == 1
    )
    assert (
        _submit(client, _slow_token(pairing, player), center=median).json()["streak"]["hot"]
        == 2
    )
    bad = _submit(client, _slow_token(pairing, player), center=2.0, wl=1, wr=1)
    assert bad.json()["score"]["total"] < GOOD_ROUND_THRESHOLD
    assert bad.json()["streak"]["hot"] == 0


def test_calibration_stats_fold_after_human_scored_rounds() -> None:
    pairing = _graduated_pairing()
    client = APIClient()
    player = _session(client)
    _submit(client, _slow_token(pairing, player), center=50.0, wl=20, wr=20)
    player.refresh_from_db()
    assert player.calibration_stats["n"] == 1
    assert player.calibration_stats["total_width"] == 40.0


def test_multiplier_multiplies_banked_xp_for_a_leveled_player() -> None:
    pairing = _graduated_pairing()
    client = APIClient()
    player = _session(client)
    # A level-2 player carrying a ×3 multiplier.
    Player.objects.filter(pk=player.pk).update(
        level=2, xp=leveling.threshold_for_level(2), xp_multiplier=3
    )
    before = Player.objects.get(pk=player.pk).xp

    body = _submit(client, _slow_token(pairing, player), center=50.0, wl=30, wr=30).json()

    player.refresh_from_db()
    assert player.xp - before == int(round(body["score"]["total"] * 3))  # ×3 applied
    covered = body["score"]["covered_fraction"]
    expected = 4 if covered >= leveling.OVERLAP_TO_ADVANCE and not body["bimodal"] else 1
    assert body["player"]["multiplier"] == expected
    assert body["player"]["level"] == player.level
    assert body["progress"]["level"] == player.level


def test_level_one_players_get_no_multiplier() -> None:
    pairing = _graduated_pairing()
    client = APIClient()
    player = _session(client)  # brand new -> level 1
    body = _submit(client, _slow_token(pairing, player), center=50.0, wl=15, wr=15).json()
    player.refresh_from_db()
    assert player.xp == int(round(body["score"]["total"]))  # ×1 at level 1
    assert body["player"]["multiplier"] == 1


# --- Pioneer path & graduation ----------------------------------------------


def test_pioneer_round_pays_the_flat_bonus_without_a_crowd() -> None:
    pairing = _make_pairing()
    client = APIClient()
    player = _session(client)

    body = _submit(client, _slow_token(pairing, player)).json()

    assert body["source"] == "pioneer"
    assert body["pioneer_bonus"] == PIONEER_BONUS
    assert body["ai_estimate"] is None
    assert "crowd" not in body
    assert "score" not in body
    player.refresh_from_db()
    assert player.xp == PIONEER_BONUS

    stored = RoundScore.objects.get(guess__player=player)
    assert stored.visible_points == PIONEER_BONUS
    assert stored.crps is None


def test_pioneer_round_includes_a_labeled_provisional_ai_estimate_when_present() -> None:
    pairing = _make_pairing()
    AIDistribution.objects.create(
        pairing=pairing, model_name="gemini-test", prompt_version="v1",
        histogram=[0.05] * 20, median=62.0, q25=50.0, q75=74.0, rationale="canned",
    )
    client = APIClient()
    player = _session(client)

    estimate = _submit(client, _slow_token(pairing, player)).json()["ai_estimate"]

    assert estimate["provisional"] is True
    assert estimate["median"] == 62.0
    assert len(estimate["histogram"]) == 20
    assert "model_name" not in estimate  # internals stay internal


def test_the_sixteenth_answer_flips_from_pioneer_to_human_scoring() -> None:
    pairing = _make_pairing()
    client = APIClient()
    player = _session(client)

    sources = []
    for i in range(16):
        token = issue_round_token(pairing, player, issued_at=time.time() - 5.0)
        sources.append(_submit(client, token, center=40.0 + i).json()["source"])

    assert sources[:15] == ["pioneer"] * 15
    assert sources[15] == "human"
    pairing.refresh_from_db()
    assert pairing.graduated

    # Human scoring uses the snapshot built from the first 15 answers.
    human_score = RoundScore.objects.filter(crps__isnull=False).get()
    assert DistributionSnapshot.objects.get(pk=human_score.components["snapshot_id"]).n == 15


# --- OpenAPI schema (WP-06 acceptance) ---------------------------------------


def test_openapi_schema_is_published_and_covers_the_round_endpoints() -> None:
    response = APIClient().get("/api/schema/?format=json")
    assert response.status_code == status.HTTP_200_OK
    paths = response.json()["paths"]
    assert "/api/round/next/" in paths
    assert "/api/round/guess/" in paths
    assert "/api/session/" in paths

"""PvP matches: pairing eligibility, joining, the start barrier, the speed race.

Executable spec:
- only rating-eligible (graduated) pairings are dealt — never a pioneer round;
- a match takes exactly two players; self-join and third-player joins are refused;
- a slot is revealed only once *both* players are ready, and response time is
  measured from that single release instant;
- the shorter think-time on a round earns ×2 on that player's *next* round, and
  the bonus never accumulates;
- a finished match names a winner by how far its arrow chain reached.
"""

import datetime

import pytest
from django.utils import timezone

from bglib.scoring import Guess as GuessValue
from core import pvp
from core.models import (
    ContentStatus,
    Guess,
    Pairing,
    Player,
    PvpEntry,
    PvpMatch,
    Scale,
    Thing,
)
from core.services import recompute_snapshot

pytestmark = pytest.mark.django_db


def _player(tag: str, level: int = 9) -> Player:
    return Player.objects.create(device_token=f"tok-{tag}", level=level, xp=600_000)


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


def _guess(center: float = 50.0) -> GuessValue:
    return GuessValue(center=center, width_left=12.0, width_right=12.0)


def _start_slot(match: PvpMatch, index: int) -> None:
    """Release the barrier for a slot by marking both players ready."""
    match.refresh_from_db()  # the opponent may have joined since this instance loaded
    pvp.mark_ready(match, match.challenger, index)
    pvp.mark_ready(match, match.opponent, index)


# --- Pairing eligibility ---------------------------------------------------


def test_only_graduated_pairings_are_used() -> None:
    graduated = _pool(10)
    # A fresh, ungraduated pairing must never be dealt into a match.
    pioneer = Pairing.objects.create(
        thing=Thing.objects.create(text="Fresh", slug="fresh"),
        scale=Scale.objects.create(left_label="a", right_label="b", slug="fresh-scale"),
    )
    ids = pvp.rating_eligible_pairing_ids(size=10)
    assert pioneer.pk not in ids
    assert set(ids) <= {p.pk for p in graduated}


def test_a_thin_pool_refuses_to_start_a_match() -> None:
    _pool(3)
    with pytest.raises(pvp.PvpError):
        pvp.rating_eligible_pairing_ids(size=10)


def test_retired_pairings_are_not_dealt() -> None:
    pool = _pool(11)
    pool[0].status = ContentStatus.REJECTED
    pool[0].save(update_fields=["status"])
    ids = pvp.rating_eligible_pairing_ids(size=10)
    assert pool[0].pk not in ids


# --- Creating and joining --------------------------------------------------


def test_create_match_deals_a_full_set_and_waits_for_an_opponent() -> None:
    _pool()
    match = pvp.create_match(_player("a"))
    assert len(match.pairing_ids) == pvp.MATCH_SIZE
    assert match.is_full is False
    assert match.join_code


def test_the_first_other_player_to_open_the_link_joins() -> None:
    _pool()
    a, b, c = _player("a"), _player("b"), _player("c")
    match = pvp.create_match(a)

    joined = pvp.join_match(b, match.join_code)
    assert joined.opponent_id == b.pk
    # Joining again is a no-op for the same player...
    assert pvp.join_match(b, match.join_code).opponent_id == b.pk
    # ...but a third player is turned away.
    with pytest.raises(pvp.PvpError):
        pvp.join_match(c, match.join_code)


def test_the_challenger_cannot_be_their_own_opponent() -> None:
    _pool()
    a = _player("a")
    match = pvp.create_match(a)
    assert pvp.join_match(a, match.join_code).opponent_id is None  # still open


def test_an_unknown_code_is_rejected() -> None:
    with pytest.raises(pvp.PvpError):
        pvp.join_match(_player("a"), "not-a-code")


# --- The start barrier -----------------------------------------------------


def test_a_slot_starts_only_once_both_players_are_ready() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)

    row = pvp.mark_ready(match, a, 0)
    assert row.started_at is None  # one player in: still waiting
    row = pvp.mark_ready(match, b, 0)
    assert row.started_at is not None  # both in: released


def test_the_blind_deal_is_withheld_until_the_barrier_releases() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)

    waiting = pvp.match_state(match, a)["next"]
    assert waiting["started"] is False
    assert "thing" not in waiting  # no question before both are ready

    _start_slot(match, 0)
    ready = pvp.match_state(match, a)["next"]
    assert ready["started"] is True
    assert ready["thing"]["text"]


def test_wait_for_start_returns_none_when_the_other_player_never_arrives() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)
    pvp.mark_ready(match, a, 0)
    assert pvp.wait_for_start(match, 0, timeout=0.0) is None


def test_response_time_is_measured_from_the_shared_release_instant() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)
    row = pvp.mark_ready(match, a, 0)
    row = pvp.mark_ready(match, b, 0)

    # Pretend the barrier released 4 seconds ago; both players are timed from it.
    row.started_at = timezone.now() - datetime.timedelta(seconds=4)
    row.save(update_fields=["started_at"])

    _body, entry = pvp.record_match_guess(match, a, 0, _guess())
    assert 3500 <= entry.response_ms <= 6000


# --- The speed race --------------------------------------------------------


def _answer(match: PvpMatch, player, index: int, *, seconds_taken: float, center=50.0):
    """Answer a slot as if the player took `seconds_taken` since the release."""
    match.refresh_from_db()
    existing = match.rounds.filter(index=index).first()
    if existing is None or existing.started_at is None:
        _start_slot(match, index)
    row = match.rounds.get(index=index)
    row.started_at = timezone.now() - datetime.timedelta(seconds=seconds_taken)
    row.save(update_fields=["started_at"])
    return pvp.record_match_guess(match, player, index, _guess(center))


def test_the_faster_player_doubles_their_next_round() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)

    _answer(match, a, 0, seconds_taken=4)   # a thinks for 4s
    _answer(match, b, 0, seconds_taken=9)   # b thinks for 9s -> a was faster

    assert pvp.speed_bonus_for(match, a, 1) is True
    assert pvp.speed_bonus_for(match, b, 1) is False

    _, fast_entry = _answer(match, a, 1, seconds_taken=5)
    _, slow_entry = _answer(match, b, 1, seconds_taken=5)
    assert fast_entry.speed_bonus is True
    assert slow_entry.speed_bonus is False
    # The bonus really doubled the round's points.
    base = fast_entry.visible_points / pvp.SPEED_BONUS
    assert fast_entry.visible_points == pytest.approx(base * 2)


def test_the_bonus_lasts_one_round_and_never_accumulates() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)

    # `a` wins round 0's race, then loses round 1's.
    _answer(match, a, 0, seconds_taken=3)
    _answer(match, b, 0, seconds_taken=8)
    _answer(match, a, 1, seconds_taken=9)
    _answer(match, b, 1, seconds_taken=2)

    assert pvp.speed_bonus_for(match, a, 2) is False  # spent, and lost the next race
    assert pvp.speed_bonus_for(match, b, 2) is True


def test_no_bonus_before_the_opponent_has_answered_that_round() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)
    _answer(match, a, 0, seconds_taken=3)  # b hasn't answered round 0 yet
    assert pvp.speed_bonus_for(match, a, 1) is False


def test_the_first_round_never_carries_a_bonus() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)
    assert pvp.speed_bonus_for(match, a, 0) is False


# --- Answering rules -------------------------------------------------------


def test_a_slot_can_only_be_answered_once() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)
    _answer(match, a, 0, seconds_taken=4)
    with pytest.raises(pvp.PvpError):
        pvp.record_match_guess(match, a, 0, _guess())


def test_a_slot_cannot_be_answered_before_it_starts() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)
    with pytest.raises(pvp.PvpError):
        pvp.record_match_guess(match, a, 0, _guess())


def test_a_stranger_cannot_answer_a_match() -> None:
    _pool()
    a, b, c = _player("a"), _player("b"), _player("c")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)
    _start_slot(match, 0)
    with pytest.raises(pvp.PvpError):
        pvp.record_match_guess(match, c, 0, _guess())


def test_a_pvp_answer_counts_as_a_normal_round_too() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)
    xp_before = a.xp
    body, entry = _answer(match, a, 0, seconds_taken=5)
    a.refresh_from_db()
    assert body["source"] == "human"  # always rated, never pioneer
    assert Guess.objects.filter(pk=entry.guess_id).exists()  # in the dataset
    assert a.xp > xp_before  # and it paid


# --- Finishing -------------------------------------------------------------


def _play_out(match: PvpMatch, a, b, *, a_center: float, b_center: float) -> None:
    for i in range(pvp.MATCH_SIZE):
        _answer(match, a, i, seconds_taken=5, center=a_center)
        _answer(match, b, i, seconds_taken=6, center=b_center)


def test_a_finished_match_names_the_winner_by_how_far_its_chain_reached() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)
    # `a` guesses the crowd's median; `b` guesses far off it.
    _play_out(match, a, b, a_center=50.0, b_center=5.0)

    match.refresh_from_db()
    assert match.completed_at is not None

    state = pvp.match_state(match, a)
    assert state["completed"] is True
    assert state["result"]["winner"] == "you"
    assert state["result"]["margin"] > 0
    # The chain endpoint is the summed (means, belief) vector.
    assert state["result"]["you_end"]["x"] > state["result"]["opponent_end"]["x"]
    # And the opponent's own view agrees on who won.
    assert pvp.match_state(match, b)["result"]["winner"] == "opponent"


def test_an_unfinished_match_has_no_result_yet() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)
    _answer(match, a, 0, seconds_taken=4)
    state = pvp.match_state(match, a)
    assert state["completed"] is False
    assert state["result"] is None
    assert state["you"]["answered"] == 1
    assert state["opponent"]["answered"] == 0


def test_state_reports_both_sides_progress_and_entries_for_the_diagram() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    match = pvp.create_match(a)
    match = pvp.join_match(b, match.join_code)
    _answer(match, a, 0, seconds_taken=4)
    _answer(match, b, 0, seconds_taken=7)

    state = pvp.match_state(match, a)
    row = state["you"]["entries"][0]
    assert set(row) == {
        "index", "points", "means_match", "belief_match", "response_ms", "speed_bonus"
    }
    assert 0.0 <= row["means_match"] <= 1.0
    assert 0.0 <= row["belief_match"] <= 1.0
    assert state["opponent"]["answered"] == 1
    assert state["speed_bonus_next"] is True  # a answered faster on round 0


def test_entries_are_scoped_to_their_own_match() -> None:
    _pool()
    a, b = _player("a"), _player("b")
    first = pvp.create_match(a)
    pvp.join_match(b, first.join_code)
    _answer(first, a, 0, seconds_taken=4)

    second = pvp.create_match(a)
    pvp.join_match(b, second.join_code)
    assert pvp.match_state(second, a)["you"]["answered"] == 0
    assert PvpEntry.objects.filter(match=second).count() == 0

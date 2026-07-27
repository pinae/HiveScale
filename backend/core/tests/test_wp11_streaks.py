"""WP-11: daily-play streak logic (plan §2.2)."""

import datetime

import pytest

from core.models import Player
from core.streaks import register_play

pytestmark = pytest.mark.django_db

D1 = datetime.date(2026, 1, 1)


def _player(**kw) -> Player:
    kw.setdefault("device_token", f"tok-{Player.objects.count()}")
    return Player.objects.create(**kw)


def test_first_play_starts_a_streak():
    p = _player()
    register_play(p, D1)
    p.refresh_from_db()
    assert p.daily_streak == 1
    assert p.last_played_on == D1


def test_the_next_day_increments():
    p = _player(daily_streak=3, last_played_on=D1)
    register_play(p, D1 + datetime.timedelta(days=1))
    p.refresh_from_db()
    assert p.daily_streak == 4


def test_replaying_the_same_day_does_nothing():
    p = _player(daily_streak=3, last_played_on=D1)
    register_play(p, D1)
    p.refresh_from_db()
    assert p.daily_streak == 3


def test_a_missed_day_resets_without_a_freeze():
    p = _player(daily_streak=5, last_played_on=D1, streak_freezes=0)
    register_play(p, D1 + datetime.timedelta(days=2))  # missed one day
    p.refresh_from_db()
    assert p.daily_streak == 1


def test_a_freeze_protects_a_single_missed_day():
    p = _player(daily_streak=5, last_played_on=D1, streak_freezes=1)
    register_play(p, D1 + datetime.timedelta(days=2))
    p.refresh_from_db()
    assert p.daily_streak == 6
    assert p.streak_freezes == 0  # consumed


def test_a_freeze_does_not_bridge_a_multi_day_gap():
    p = _player(daily_streak=5, last_played_on=D1, streak_freezes=1)
    register_play(p, D1 + datetime.timedelta(days=4))  # missed three days
    p.refresh_from_db()
    assert p.daily_streak == 1
    assert p.streak_freezes == 1  # not consumed


def test_a_seven_day_streak_earns_a_freeze():
    p = _player(daily_streak=6, last_played_on=D1, streak_freezes=0)
    register_play(p, D1 + datetime.timedelta(days=1))
    p.refresh_from_db()
    assert p.daily_streak == 7
    assert p.streak_freezes == 1

"""Daily Wave generation and the shareable emoji result (plan §2.2)."""

import datetime

import pytest
from django.core.management import call_command

from core.daily_wave import generate_daily_wave, grade_emoji, share_string
from core.models import DailyWave, Pairing, Scale, Thing

pytestmark = pytest.mark.django_db

DAY = datetime.date(2026, 1, 1)


def _make_pairings(n: int) -> list[Pairing]:
    pairings = []
    for i in range(n):
        thing = Thing.objects.create(text=f"Thing {i}", slug=f"thing-{i}")
        scale = Scale.objects.create(left_label=f"l{i}", right_label=f"r{i}", slug=f"scale-{i}")
        pairings.append(Pairing.objects.create(thing=thing, scale=scale))
    return pairings


def test_generation_is_deterministic_and_idempotent():
    _make_pairings(30)
    first = generate_daily_wave(DAY, size=10)
    second = generate_daily_wave(DAY, size=10)
    assert len(first.pairing_ids) == 10
    assert first.pairing_ids == second.pairing_ids  # same date -> same wave
    assert DailyWave.objects.filter(date=DAY).count() == 1  # not duplicated


def test_consecutive_waves_do_not_repeat_pairings():
    # A pool comfortably larger than two waves: yesterday's pairings must all rest.
    _make_pairings(40)
    yesterday = generate_daily_wave(DAY - datetime.timedelta(days=1), size=10)
    today = generate_daily_wave(DAY, size=10)
    assert set(today.pairing_ids).isdisjoint(yesterday.pairing_ids)


def test_cooldown_relaxes_when_the_pool_is_too_small():
    # Only 12 pairings but two 10-slot waves need 20 distinct — repeats are allowed
    # rather than shrinking the wave.
    _make_pairings(12)
    generate_daily_wave(DAY - datetime.timedelta(days=1), size=10)
    today = generate_daily_wave(DAY, size=10)
    assert len(today.pairing_ids) == 10


def test_only_active_pairings_are_chosen():
    active = _make_pairings(12)
    active_ids = {p.id for p in active}
    wave = generate_daily_wave(DAY, size=10)
    assert set(wave.pairing_ids) <= active_ids


def test_every_player_reads_the_same_wave_for_a_date():
    _make_pairings(15)
    generate_daily_wave(DAY)
    a = DailyWave.objects.get(date=DAY).pairing_ids
    b = DailyWave.objects.get(date=DAY).pairing_ids
    assert a == b


def test_generation_needs_active_pairings():
    with pytest.raises(ValueError):
        generate_daily_wave(DAY)


def test_management_command_creates_the_wave():
    _make_pairings(12)
    call_command("generate_daily_wave", "--date", "2026-01-01", "--size", "8")
    assert DailyWave.objects.get(date=DAY).pairing_ids != []
    assert len(DailyWave.objects.get(date=DAY).pairing_ids) == 8


def test_grade_emoji_thresholds():
    assert grade_emoji(950) == "🎯"
    assert grade_emoji(600) == "🌊"
    assert grade_emoji(300) == "🌫️"
    assert grade_emoji(10) == "🥶"


def test_share_string_snapshot():
    result = share_string(DAY, [920.0, 640.0, 300.0, 50.0], daily_streak=3)
    assert result == "HiveScale 2026-01-01\n🎯🌊🌫️🥶\n1910 pts · 🔥3"

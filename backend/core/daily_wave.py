"""Daily Wave (WP-11, plan §2.2): one fixed set of pairings per calendar day,
identical for everyone, plus a Wordle-style shareable emoji result.
"""

import datetime
import random

from django.conf import settings

from core.models import ContentStatus, DailyWave, Pairing

#: How many pairings make up a Daily Wave.
WAVE_SIZE = 10


def daily_wave_level() -> int:
    """Player level that unlocks the Daily Wave (plan §2.2)."""
    return int(getattr(settings, "DAILY_WAVE_LEVEL", 3))


def daily_wave_cooldown_days() -> int:
    """How many days a pairing rests before it can headline another Daily Wave —
    so the same question never lands on consecutive (or near-consecutive) days,
    which players easily remember."""
    return int(getattr(settings, "DAILY_WAVE_COOLDOWN_DAYS", 30))

#: Score thresholds (0-1000) mapped to a result emoji, best first.
GRADES: tuple[tuple[float, str], ...] = (
    (800.0, "🎯"),  # bullseye
    (500.0, "🌊"),  # rode the wave
    (250.0, "🌫️"),  # foggy
    (0.0, "🥶"),  # cold
)


def _active_pairing_ids() -> list[int]:
    return list(
        Pairing.objects.filter(
            status=ContentStatus.ACTIVE,
            thing__status=ContentStatus.ACTIVE,
            scale__status=ContentStatus.ACTIVE,
        ).values_list("id", flat=True)
    )


def _recent_wave_pairing_ids(day: datetime.date, cooldown_days: int) -> set[int]:
    """Pairing ids used by the Daily Waves in the ``cooldown_days`` before ``day``
    (earlier dates only, so regenerating a given day's wave stays reproducible)."""
    if cooldown_days <= 0:
        return set()
    since = day - datetime.timedelta(days=cooldown_days)
    used: set[int] = set()
    for pairing_ids in DailyWave.objects.filter(date__lt=day, date__gte=since).values_list(
        "pairing_ids", flat=True
    ):
        used.update(pairing_ids)
    return used


def generate_daily_wave(
    day: datetime.date,
    size: int = WAVE_SIZE,
    rng: random.Random | None = None,
    cooldown_days: int | None = None,
) -> DailyWave:
    """Create (or refresh) the Daily Wave for ``day``.

    Selection is seeded by the date, so it is reproducible and idempotent — every
    player who reads the wave for a date sees the same pairings, in the same order.

    Pairings used by a Daily Wave in the previous ``cooldown_days`` are held back
    so a question doesn't recur within a month. If honouring the cooldown would
    leave too few pairings to fill the wave, it's relaxed to the full active pool
    (a repeat beats a short wave).
    """
    ids = _active_pairing_ids()
    if not ids:
        raise ValueError("no active pairings to build a Daily Wave from")
    rng = rng or random.Random(day.toordinal())

    cooldown = daily_wave_cooldown_days() if cooldown_days is None else cooldown_days
    resting = _recent_wave_pairing_ids(day, cooldown)
    pool = [i for i in ids if i not in resting]
    want = min(size, len(ids))
    if len(pool) < want:
        pool = ids  # not enough rested pairings — allow repeats rather than short-change the wave

    chosen = sorted(rng.sample(pool, min(want, len(pool))))
    wave, _ = DailyWave.objects.update_or_create(date=day, defaults={"pairing_ids": chosen})
    return wave


def grade_emoji(score: float) -> str:
    """Map a visible round score (0-1000) to its result emoji."""
    for threshold, emoji in GRADES:
        if score >= threshold:
            return emoji
    return GRADES[-1][1]


def share_string(day: datetime.date, scores: list[float], daily_streak: int = 0) -> str:
    """A shareable, spoiler-free emoji summary of a player's Daily Wave."""
    row = "".join(grade_emoji(s) for s in scores)
    total = round(sum(scores))
    footer = f"{total} pts"
    if daily_streak:
        footer += f" · 🔥{daily_streak}"
    return f"HiveScale {day.isoformat()}\n{row}\n{footer}"

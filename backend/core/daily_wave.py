"""Daily Wave (WP-11, plan §2.2): one fixed set of pairings per calendar day,
identical for everyone, plus a Wordle-style shareable emoji result.
"""

import datetime
import random

from core.models import ContentStatus, DailyWave, Pairing

#: How many pairings make up a Daily Wave.
WAVE_SIZE = 10

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


def generate_daily_wave(
    day: datetime.date, size: int = WAVE_SIZE, rng: random.Random | None = None
) -> DailyWave:
    """Create (or refresh) the Daily Wave for ``day``.

    Selection is seeded by the date, so it is reproducible and idempotent — every
    player who reads the wave for a date sees the same pairings, in the same order.
    """
    ids = _active_pairing_ids()
    if not ids:
        raise ValueError("no active pairings to build a Daily Wave from")
    rng = rng or random.Random(day.toordinal())
    chosen = sorted(rng.sample(ids, min(size, len(ids))))
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
    return f"Baseline Guesser {day.isoformat()}\n{row}\n{footer}"

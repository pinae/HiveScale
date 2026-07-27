"""Daily-play streak logic (WP-11, plan §2.2).

A player's daily streak grows once per calendar day they play, resets when a day
is missed, and is protected by streak-freeze items — earned by playing, never
paid. The "today" date is injected so callers control the timezone and tests
stay deterministic.
"""

import datetime

#: Streak length (in days) that earns one freeze, and the freeze cap.
FREEZE_EVERY = 7
MAX_FREEZES = 3


def register_play(player, today: datetime.date) -> None:
    """Record that ``player`` played on ``today`` and update their daily streak.

    - same day again: no change;
    - the next day: +1;
    - exactly one day missed with a freeze in hand: consume it and continue;
    - otherwise: reset to 1.

    Reaching a multiple of :data:`FREEZE_EVERY` days earns a freeze (capped).
    """
    last = player.last_played_on
    if last == today:
        return

    if last is None:
        player.daily_streak = 1
    else:
        gap = (today - last).days
        if gap == 1:
            player.daily_streak += 1
        elif gap == 2 and player.streak_freezes > 0:
            player.streak_freezes -= 1
            player.daily_streak += 1
        else:
            player.daily_streak = 1

    if player.daily_streak % FREEZE_EVERY == 0 and player.streak_freezes < MAX_FREEZES:
        player.streak_freezes += 1

    player.last_played_on = today
    player.save(update_fields=["daily_streak", "last_played_on", "streak_freezes"])

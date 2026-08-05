"""Progression: the XP → level curve and the calibration XP multiplier.

Two knobs drive the whole progression system (plan §2.x, contribution unlocks):

* **Levels** gate what a player can do — normal play (1-4), pairing voting (5+),
  thing challenges (10+), scale requests (15+). The XP cost of each level widens
  sharply, so the early levels come fast but L5 takes real, *calibrated* play.

* **The XP multiplier** rewards calibrated guessing. From level 2 it climbs by one
  each time a graduated round is a *good match* — the guess clears the match
  threshold on either the crowd's means or its summed beliefs — up to ×10, and
  resets on a poor round. A "society at war" (bimodal) round is neutral. XP earned
  is the round's visible score times the multiplier, so a heavy player only reaches
  L5 inside a fortnight by sustaining a high multiplier — not by grinding volume.

All numbers are tunable; keep ``LEVEL_THRESHOLDS`` strictly increasing.
"""

#: Cumulative XP required to *reach* each level (index 0 is level 1 at 0 XP). The
#: L4→L5 wall (40k → 500k) is deliberate: ~50 rounds/day at ×1 is ~20 days to L5,
#: so the multiplier is the only way in under two weeks.
LEVEL_THRESHOLDS: list[int] = [
    0,            # 1
    1_500,        # 2  — multiplier unlocks
    8_000,        # 3
    40_000,       # 4
    500_000,      # 5  — pairing voting unlocks
    1_200_000,    # 6
    2_200_000,    # 7
    3_600_000,    # 8
    5_500_000,    # 9
    8_000_000,    # 10 — thing challenges unlock
    11_000_000,   # 11
    15_000_000,   # 12
    20_000_000,   # 13
    26_000_000,   # 14
    34_000_000,   # 15 — scale requests unlock
]

#: Beyond the table each further level costs the last tabulated step again.
_TAIL_STEP = LEVEL_THRESHOLDS[-1] - LEVEL_THRESHOLDS[-2]

MAX_MULTIPLIER = 10
#: The multiplier (and its rewards) only apply from this level up.
MULTIPLIER_MIN_LEVEL = 2


def level_for_xp(xp: int) -> int:
    """The level a player with ``xp`` total experience has reached."""
    level = 1
    for i, threshold in enumerate(LEVEL_THRESHOLDS, start=1):
        if xp >= threshold:
            level = i
        else:
            return level
    return len(LEVEL_THRESHOLDS) + (xp - LEVEL_THRESHOLDS[-1]) // _TAIL_STEP


def threshold_for_level(level: int) -> int:
    """Cumulative XP needed to reach ``level`` (extrapolated past the table)."""
    if level <= len(LEVEL_THRESHOLDS):
        return LEVEL_THRESHOLDS[level - 1]
    return LEVEL_THRESHOLDS[-1] + _TAIL_STEP * (level - len(LEVEL_THRESHOLDS))


def level_progress(xp: int) -> dict:
    """Level + how far into it, for a progress bar."""
    level = level_for_xp(xp)
    floor = threshold_for_level(level)
    ceiling = threshold_for_level(level + 1)
    return {
        "level": level,
        "xp": xp,
        "into_level": xp - floor,
        "level_span": ceiling - floor,
        "next_level_xp": ceiling,
    }


def effective_multiplier(level: int, multiplier: int) -> int:
    """The multiplier actually applied to XP — ×1 until it has unlocked."""
    return multiplier if level >= MULTIPLIER_MIN_LEVEL else 1


def next_multiplier(
    current: int,
    *,
    level: int,
    source: str,
    bimodal: bool,
    good_match: bool | None,
) -> int:
    """The XP multiplier for the player's *next* round after this one resolves.

    Only graduated ("human") rounds move it, and only once unlocked. A bimodal
    round is neutral; a good-match round grows it (capped); anything less resets
    it to 1. ``good_match`` is ``None`` when the round can't move the multiplier
    (pioneer rounds), in which case it's left unchanged.
    """
    if level < MULTIPLIER_MIN_LEVEL:
        return 1
    if source != "human" or bimodal or good_match is None:
        return current
    if good_match:
        return min(MAX_MULTIPLIER, current + 1)
    return 1


def next_hot_streak(current: int, *, bimodal: bool, good_match: bool) -> int:
    """The hot streak — calibrated guesses in a row — after this round resolves.

    Deliberately the *same* good-match rule that moves the multiplier, so the two
    never disagree: a good match extends it, a poor one breaks it, and a bimodal
    ("society at war") round is neutral. Pioneer rounds don't call this, so they
    leave the streak untouched. The streak is the uncapped run; the multiplier is
    that run turned into an XP reward (capped ×10, and only from level 2).
    """
    if bimodal:
        return current
    return current + 1 if good_match else 0

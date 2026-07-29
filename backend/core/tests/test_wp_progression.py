"""Progression: the XP → level curve and the calibration XP multiplier.

Executable spec:
- levels come from cumulative XP with sharply widening steps (L5 is a wall);
- the multiplier unlocks at level 2, climbs on ≥70%-covered graduated rounds to
  a ×10 cap, is neutral on bimodal ("society at war") rounds, and resets on a
  poorly-covered round;
- XP banked per round is the visible score times the effective multiplier.
"""


from core import leveling

# --- Pure curve ------------------------------------------------------------


def test_level_thresholds_are_strictly_increasing():
    t = leveling.LEVEL_THRESHOLDS
    assert t[0] == 0
    assert all(b > a for a, b in zip(t, t[1:], strict=False))


def test_level_for_xp_maps_across_the_gates():
    assert leveling.level_for_xp(0) == 1
    assert leveling.level_for_xp(1_499) == 1
    assert leveling.level_for_xp(1_500) == 2  # multiplier unlock
    assert leveling.level_for_xp(499_999) == 4
    assert leveling.level_for_xp(500_000) == 5  # voting unlock
    assert leveling.level_for_xp(8_000_000) == 10  # challenges unlock
    assert leveling.level_for_xp(34_000_000) == 15  # scale requests unlock


def test_level_extrapolates_past_the_table():
    top = len(leveling.LEVEL_THRESHOLDS)
    step = leveling.LEVEL_THRESHOLDS[-1] - leveling.LEVEL_THRESHOLDS[-2]
    assert leveling.level_for_xp(leveling.LEVEL_THRESHOLDS[-1] + step) == top + 1


def test_l5_needs_a_multiplier_within_a_fortnight():
    # ~50 rounds/day at ~500 pts, un-multiplied, over two weeks:
    volume_only = 50 * 500 * 14
    assert leveling.threshold_for_level(5) > volume_only  # grind alone can't do it
    # ...but a sustained high multiplier gets there comfortably.
    assert leveling.threshold_for_level(5) < volume_only * 8


def test_level_progress_reports_position_within_the_level():
    p = leveling.level_progress(5_000)  # between L2 (1,500) and L3 (8,000)
    assert p["level"] == 2
    assert p["into_level"] == 3_500
    assert p["level_span"] == 6_500
    assert p["next_level_xp"] == 8_000


# --- Multiplier transitions ------------------------------------------------


def test_multiplier_is_locked_below_level_two():
    assert leveling.effective_multiplier(1, 7) == 1
    assert leveling.effective_multiplier(2, 7) == 7
    assert (
        leveling.next_multiplier(1, level=1, source="human", bimodal=False, covered_fraction=0.9)
        == 1
    )


def test_multiplier_climbs_on_well_covered_rounds_and_caps():
    assert (
        leveling.next_multiplier(1, level=2, source="human", bimodal=False, covered_fraction=0.71)
        == 2
    )
    assert (
        leveling.next_multiplier(10, level=6, source="human", bimodal=False, covered_fraction=0.99)
        == 10
    )


def test_multiplier_resets_on_a_poorly_covered_round():
    assert (
        leveling.next_multiplier(6, level=5, source="human", bimodal=False, covered_fraction=0.5)
        == 1
    )


def test_bimodal_and_pioneer_rounds_are_neutral():
    assert (
        leveling.next_multiplier(4, level=5, source="human", bimodal=True, covered_fraction=0.9)
        == 4
    )
    assert (
        leveling.next_multiplier(4, level=5, source="pioneer", bimodal=False, covered_fraction=None)
        == 4
    )

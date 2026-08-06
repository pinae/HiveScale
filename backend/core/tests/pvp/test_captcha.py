"""Humanity checks guarding the PvP email invite (anti-spam-relay).

Executable spec:
- an answer faster than 1.5s is not a human reading a question;
- a supplied pointer path must look like a hand: enough samples, real travel,
  varying step sizes/timing, and not a perfect straight line;
- clients with no pointer (touch, keyboard) send no path and are not locked out.
"""

import pytest

from core.captcha import CAPTCHA_MIN_MS, NotHuman, check_pointer_path, verify_human


def _human_path(n: int = 24) -> list[list[float]]:
    """A wandering, unevenly-timed drag — what a real hand produces."""
    jitter = [0, 3, -2, 5, -1, 4, 2, -3, 6, 1, -4, 2]
    points = []
    x = y = t = 0.0
    for i in range(n):
        x += 12 + jitter[i % len(jitter)]
        y += jitter[(i + 5) % len(jitter)]
        t += 16 + (jitter[(i + 3) % len(jitter)] % 11)
        points.append([x, y, t])
    return points


# --- Timing ----------------------------------------------------------------


def test_an_instant_answer_is_rejected() -> None:
    with pytest.raises(NotHuman):
        verify_human(200, _human_path())


def test_the_threshold_is_one_and_a_half_seconds() -> None:
    with pytest.raises(NotHuman):
        verify_human(CAPTCHA_MIN_MS - 1, _human_path())
    verify_human(CAPTCHA_MIN_MS, _human_path())  # exactly at the bar: allowed


def test_an_unhurried_answer_passes() -> None:
    verify_human(6000, _human_path())


# --- Pointer plausibility --------------------------------------------------


def test_no_path_is_accepted_for_touch_and_keyboard_players() -> None:
    check_pointer_path(None)
    check_pointer_path([])
    verify_human(6000, None)


def test_a_human_drag_passes() -> None:
    check_pointer_path(_human_path())


def test_too_few_samples_is_rejected() -> None:
    with pytest.raises(NotHuman):
        check_pointer_path([[0, 0, 0], [10, 2, 16], [20, 5, 33]])


def test_a_path_that_barely_moved_is_rejected() -> None:
    tiny = [[i * 0.5, 0, i * 16] for i in range(20)]  # ~10px of travel
    with pytest.raises(NotHuman):
        check_pointer_path(tiny)


def test_perfectly_uniform_steps_and_timing_are_rejected() -> None:
    # A script: identical deltas, identical frame gaps.
    robotic = [[i * 15, i * 15, i * 16] for i in range(20)]
    with pytest.raises(NotHuman):
        check_pointer_path(robotic)


def test_a_perfectly_straight_long_drag_is_rejected() -> None:
    # Varying step sizes but exactly collinear — a synthesised swipe.
    straight, x, t = [], 0.0, 0.0
    for i in range(24):
        x += 10 + (i % 7) * 3  # uneven steps...
        t += 12 + (i % 5) * 4
        straight.append([x, 0.0, t])  # ...but never leaves the line y=0
    with pytest.raises(NotHuman):
        check_pointer_path(straight)


def test_malformed_points_are_dropped_rather_than_crashing() -> None:
    # All-junk degrades to "no path", which is the same lenient case as a touch
    # client — the timing check and the real scored round still stand behind it.
    check_pointer_path([["a", "b", "c"], [1, 2], None, "junk"])
    # Junk mixed into a real path is dropped, and what remains is still judged.
    with pytest.raises(NotHuman):
        check_pointer_path([*[[i * 15, i * 15, i * 16] for i in range(20)], "junk", None])


def test_a_reason_is_player_facing() -> None:
    with pytest.raises(NotHuman) as exc:
        verify_human(100, _human_path())
    assert "quick" in exc.value.reason.lower()

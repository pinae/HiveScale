"""Humanity checks for the PvP email invite (anti-bot).

Sending mail on a stranger's behalf is the one place the game can be abused as a
spam relay, so the invite is gated behind a *real* round the challenger must
actually play, plus two cheap signals that the answer came from a person:

1. **It wasn't instant.** A human reads the thing, the scale, and moves a slider.
   Anything under :data:`CAPTCHA_MIN_MS` is a script. The elapsed time is measured
   server-side from the signed captcha token, so a client can't fake it.
2. **The pointer moved like a hand.** Real dragging wanders: step sizes and
   sample intervals vary, and the path is not a perfect straight line. Scripted
   input tends to be a handful of identical deltas along one vector.

Both checks are deliberately forgiving — a false reject costs a real player their
invite. Clients with no mouse (touch, keyboard-only) send no path and are judged
on the timing and the genuine guess alone.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

#: A captcha round answered faster than this is not a human reading a question.
CAPTCHA_MIN_MS = 1500

#: With fewer samples than this there isn't enough signal to judge a path, so a
#: (present but tiny) path is treated as suspicious.
MIN_PATH_POINTS = 8
#: Total pointer travel, in px, below which the "drag" didn't really happen.
MIN_PATH_TRAVEL_PX = 40
#: Relative spread (std/mean) a human's step sizes and sample gaps exceed.
MIN_STEP_VARIATION = 0.15
#: Mean distance (px) from the straight start→end line, below which the path is
#: suspiciously perfect. Only applied once the path has travelled a fair way.
MIN_PATH_CURVATURE_PX = 1.5

Point = Sequence[float]  # (x, y, t_ms)


class NotHuman(Exception):
    """The captcha attempt failed a humanity check. ``reason`` is player-facing."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _relative_spread(values: list[float]) -> float:
    """std / mean — 0 for perfectly uniform values, grows with natural jitter."""
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    if mean <= 0:
        return 0.0
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    return math.sqrt(variance) / mean


def _mean_deviation_from_chord(points: list[tuple[float, float]]) -> float:
    """Average distance of the path from the straight line joining its ends."""
    (x0, y0), (x1, y1) = points[0], points[-1]
    dx, dy = x1 - x0, y1 - y0
    chord = math.hypot(dx, dy)
    if chord <= 0:
        return 0.0
    # |cross product| / |chord| is the perpendicular distance to the line.
    return sum(abs(dx * (y0 - y) - (x0 - x) * dy) / chord for x, y in points) / len(points)


def _parse_path(raw: object) -> list[tuple[float, float, float]]:
    """Coerce the client's ``[[x, y, t], …]`` into floats, ignoring junk entries."""
    if not isinstance(raw, (list, tuple)):
        return []
    points: list[tuple[float, float, float]] = []
    for item in raw:
        if not isinstance(item, (list, tuple)) or len(item) < 3:
            continue
        try:
            points.append((float(item[0]), float(item[1]), float(item[2])))
        except (TypeError, ValueError):
            continue
    return points


def check_pointer_path(raw: object) -> None:
    """Raise :class:`NotHuman` if a *supplied* pointer path doesn't look human.

    An empty/absent path is accepted — touch and keyboard players have none.
    """
    points = _parse_path(raw)
    if not points:
        return
    if len(points) < MIN_PATH_POINTS:
        raise NotHuman("That didn't look like a real drag. Give the slider a proper move.")

    xy = [(x, y) for x, y, _ in points]
    steps = [math.dist(xy[i - 1], xy[i]) for i in range(1, len(xy))]
    travel = sum(steps)
    if travel < MIN_PATH_TRAVEL_PX:
        raise NotHuman("That didn't look like a real drag. Give the slider a proper move.")

    gaps = [max(0.0, points[i][2] - points[i - 1][2]) for i in range(1, len(points))]
    moving_steps = [s for s in steps if s > 0]
    # A hand never produces perfectly even steps *and* perfectly even timing.
    if (
        _relative_spread(moving_steps) < MIN_STEP_VARIATION
        and _relative_spread(gaps) < MIN_STEP_VARIATION
    ):
        raise NotHuman("That pointer movement looked automated. Try again.")

    # Nor a perfectly straight line over a long drag.
    if travel >= 4 * MIN_PATH_TRAVEL_PX and _mean_deviation_from_chord(xy) < MIN_PATH_CURVATURE_PX:
        raise NotHuman("That pointer movement looked automated. Try again.")


def verify_human(elapsed_ms: int, pointer_path: object = None) -> None:
    """Run every humanity check for a captcha attempt.

    Raises :class:`NotHuman` with a player-facing reason on the first failure.
    """
    if elapsed_ms < CAPTCHA_MIN_MS:
        raise NotHuman("That was too quick — take a moment to read the question.")
    check_pointer_path(pointer_path)

"""Tiny dependency-free SVG charts for the research admin (WP-13).

Pure string builders — no matplotlib, no JS, no external assets — so they render
inline in the Django admin and stay trivially testable. Two shapes cover the
research questions:

- :func:`histogram_svg` — a pairing's crowd distribution (20 buckets) with the
  IQR band and median marked, and an optional AI-prior overlay;
- :func:`heatmap_svg` — the scale×scale correlation matrix as a colour grid.

Values are assumed already validated by :mod:`core.dataset`; these functions only
draw. Every number that reaches an attribute goes through ``_f`` (fixed, escaped)
so the output is safe to mark_safe in a template.
"""

from __future__ import annotations

import html
import math
from collections.abc import Sequence

from bglib.scoring import N_BUCKETS, SCALE_MAX


def _f(value: float) -> str:
    """Format a float compactly and finitely for an SVG attribute."""
    if not math.isfinite(value):
        return "0"
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _esc(text: str) -> str:
    return html.escape(str(text), quote=True)


def histogram_svg(
    histogram: Sequence[float],
    *,
    median: float | None = None,
    q25: float | None = None,
    q75: float | None = None,
    ai_histogram: Sequence[float] | None = None,
    width: int = 240,
    height: int = 80,
) -> str:
    """A compact crowd-distribution bar chart, 0 (left) to 100 (right).

    The IQR ``[q25, q75]`` is a shaded band, the median a vertical line, and an
    optional ``ai_histogram`` is overlaid as an outline so AI-vs-human divergence
    is visible at a glance.
    """
    bars = list(histogram)
    peak = max(bars) if bars else 0.0
    scale_y = (height - 2) / peak if peak > 0 else 0.0
    bar_w = width / N_BUCKETS

    def x_of(value: float) -> float:
        return width * value / SCALE_MAX

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img">',
        # Light backing so the dark median line and bars read under any theme.
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>',
    ]

    # IQR band.
    if q25 is not None and q75 is not None and q75 > q25:
        parts.append(
            f'<rect x="{_f(x_of(q25))}" y="0" width="{_f(x_of(q75) - x_of(q25))}" '
            f'height="{height}" fill="#3b82f6" opacity="0.12"/>'
        )

    # Crowd bars.
    for i, weight in enumerate(bars):
        bar_h = weight * scale_y
        if bar_h <= 0:
            continue
        parts.append(
            f'<rect x="{_f(i * bar_w + 0.5)}" y="{_f(height - bar_h)}" '
            f'width="{_f(bar_w - 1)}" height="{_f(bar_h)}" fill="#2563eb"/>'
        )

    # AI overlay as a polyline across bucket tops.
    if ai_histogram is not None:
        ai_bars = list(ai_histogram)
        ai_peak = max(ai_bars) if ai_bars else 0.0
        ai_scale = (height - 2) / ai_peak if ai_peak > 0 else 0.0
        points = " ".join(
            f"{_f(i * bar_w + bar_w / 2)},{_f(height - w * ai_scale)}"
            for i, w in enumerate(ai_bars)
        )
        parts.append(
            f'<polyline points="{points}" fill="none" stroke="#dc2626" '
            f'stroke-width="1.5" opacity="0.85"/>'
        )

    # Median line.
    if median is not None:
        mx = x_of(median)
        parts.append(
            f'<line x1="{_f(mx)}" y1="0" x2="{_f(mx)}" y2="{height}" '
            f'stroke="#111827" stroke-width="1.5"/>'
        )

    parts.append("</svg>")
    return "".join(parts)


def _correlation_color(r: float) -> str:
    """Blue (−1) … white (0) … red (+1) for a correlation cell."""
    if not math.isfinite(r):
        return "#f3f4f6"
    r = max(-1.0, min(1.0, r))
    if r >= 0:
        # white -> red
        g = b = int(round(255 * (1 - r)))
        return f"rgb(255,{g},{b})"
    # white -> blue
    rr = g = int(round(255 * (1 + r)))
    return f"rgb({rr},{g},255)"


def heatmap_svg(
    labels: Sequence[str],
    corr: Sequence[Sequence[float]],
    *,
    cell: int = 26,
    label_px: int = 130,
) -> str:
    """A scale×scale correlation heatmap with a rotated axis of scale labels."""
    n = len(labels)
    if n == 0:
        return '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>'

    grid = n * cell
    width = label_px + grid + 4
    height = label_px + grid + 4
    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" font-family="sans-serif" font-size="10">',
        # A solid light background so the chart is readable regardless of the
        # admin theme (the dark theme would otherwise leave dark text on dark).
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>',
    ]

    # Cells. The in-cell number is pointer-events:none so hovering a cell always
    # surfaces the rect's <title> tooltip, even where a value is printed on top.
    for i in range(n):
        for j in range(n):
            r = float(corr[i][j]) if corr[i][j] is not None else float("nan")
            x = label_px + j * cell
            y = label_px + i * cell
            title = f"{labels[i]} × {labels[j]}: {'n/a' if not math.isfinite(r) else _f(r)}"
            parts.append(
                f'<rect x="{x}" y="{y}" width="{cell}" height="{cell}" '
                f'fill="{_correlation_color(r)}" stroke="#e5e7eb">'
                f"<title>{_esc(title)}</title></rect>"
            )
            if math.isfinite(r) and abs(r) >= 0.5:
                tx, ty = x + cell / 2, y + cell / 2 + 3
                fill = "#fff" if abs(r) >= 0.8 else "#111"
                parts.append(
                    f'<text x="{_f(tx)}" y="{_f(ty)}" text-anchor="middle" '
                    f'fill="{fill}" pointer-events="none">{_f(r)}</text>'
                )

    # Row labels (left) and column labels (rotated, top) — explicit dark fill so
    # they read on the light background under any admin theme.
    for i, label in enumerate(labels):
        ry = label_px + i * cell + cell / 2 + 3
        parts.append(
            f'<text x="{label_px - 4}" y="{_f(ry)}" text-anchor="end" '
            f'fill="#111827">{_esc(label)}</text>'
        )
        cx = label_px + i * cell + cell / 2
        parts.append(
            f'<text x="{_f(cx)}" y="{label_px - 4}" text-anchor="start" fill="#111827" '
            f'transform="rotate(-90 {_f(cx)} {label_px - 4})">{_esc(label)}</text>'
        )

    parts.append("</svg>")
    return "".join(parts)

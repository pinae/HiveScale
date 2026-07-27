/**
 * Pure interaction model for the WaveSlider (WP-08).
 *
 * A guess is `{ center, widthLeft, widthRight }` on a `[min, max]` scale, where
 * the widths are the player's *desired* half-widths. The visible/submittable
 * interval is those widths clamped so neither border leaves the scale — which is
 * what makes the interval "breathe":
 *
 * - dragging the centre keeps the desired widths, so a side squashed against a
 *   wall grows back to its desired size as the centre moves away again;
 * - dragging one end sets that border, keeps the other border fixed, and only
 *   nudges the centre when the end would otherwise cross it (the centre always
 *   stays inside the interval);
 * - the wheel / vertical drag resize symmetrically around the centre.
 *
 * No border ever leaves `[min, max]`. Every function is pure so the component
 * wiring stays a thin translation of pointer/keyboard events to these calls.
 */

export interface GuessValue {
  center: number;
  widthLeft: number;
  widthRight: number;
}

export interface Bounds {
  lower: number;
  upper: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The visible interval: desired widths clamped so no border leaves the scale. */
export function effectiveBounds(v: GuessValue, min: number, max: number): Bounds {
  return {
    lower: Math.max(min, v.center - v.widthLeft),
    upper: Math.min(max, v.center + v.widthRight),
  };
}

/** Move the centre; desired widths are preserved (the interval travels along). */
export function moveCenter(v: GuessValue, targetCenter: number, min: number, max: number): GuessValue {
  return { ...v, center: clamp(targetCenter, min, max) };
}

/**
 * Drag one interval end to `targetPos`. The opposite border stays put; the
 * centre only moves if the dragged end would cross it (the interval can shrink
 * to zero but never invert), and the new widths become the desired widths.
 */
export function dragEnd(
  v: GuessValue,
  side: "lower" | "upper",
  targetPos: number,
  min: number,
  max: number,
): GuessValue {
  const { lower, upper } = effectiveBounds(v, min, max);
  const p = clamp(targetPos, min, max);
  if (side === "upper") {
    const newUpper = Math.max(p, lower);
    const newCenter = clamp(v.center, lower, newUpper);
    return { center: newCenter, widthLeft: newCenter - lower, widthRight: newUpper - newCenter };
  }
  const newLower = Math.min(p, upper);
  const newCenter = clamp(v.center, newLower, upper);
  return { center: newCenter, widthLeft: newCenter - newLower, widthRight: upper - newCenter };
}

/** The current symmetric half-width (bounded so it fits inside the scale). */
export function symmetricHalf(v: GuessValue, min: number, max: number): number {
  const maxHalf = Math.min(v.center - min, max - v.center);
  return Math.min((v.widthLeft + v.widthRight) / 2, maxHalf);
}

/** Centre the interval and set both half-widths to `half`, kept inside the scale. */
export function setSymmetricHalf(v: GuessValue, half: number, min: number, max: number): GuessValue {
  const maxHalf = Math.min(v.center - min, max - v.center);
  const h = clamp(half, 0, maxHalf);
  return { center: v.center, widthLeft: h, widthRight: h };
}

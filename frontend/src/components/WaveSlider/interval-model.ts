/**
 * Pure interaction model for the WaveSlider (WP-08).
 *
 * A guess is `{ center, widthLeft, widthRight }` on a `[min, max]` scale, where
 * the widths are the per-side **standard deviations** of the guessed bell — a
 * free shape parameter, not the interval edge. σ ranges over `[0, sigmaCap]`
 * (the full scale span); the scale walls only *truncate the display*, they no
 * longer cap σ. That's what lets a guess pinned near a wall still carry a lot of
 * mass at the wall (a wide, flat truncated bell).
 *
 * - dragging the centre moves the mean, widths riding along;
 * - the wheel / centre vertical drag change *both* widths together (spread);
 * - each σ handle sets one side's σ directly — dragging it out along the scale,
 *   then *down* the rail's wall-drop to push σ past the wall (see
 *   {@link handlePlacement});
 * - `effectiveBounds` is the in-scale ±1σ interval (clamped to the walls), used
 *   only for the display band / guide lines.
 *
 * Every function is pure so the component wiring stays a thin translation of
 * pointer/keyboard events to these calls.
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

/** The largest σ a handle can express — the full scale span. At this value the
 * handle has dropped all the way down its wall-rail and the truncated bell is
 * nearly flat. */
export function sigmaCap(min: number, max: number): number {
  return Math.max(1, max - min);
}

/** The visible ±1σ interval: widths clamped so no border leaves the scale. */
export function effectiveBounds(v: GuessValue, min: number, max: number): Bounds {
  return {
    lower: Math.max(min, v.center - v.widthLeft),
    upper: Math.min(max, v.center + v.widthRight),
  };
}

/** Move the centre; widths are preserved (the bell travels along). */
export function moveCenter(v: GuessValue, targetCenter: number, min: number, max: number): GuessValue {
  return { ...v, center: clamp(targetCenter, min, max) };
}

/**
 * Set both half-widths toward a target, clamped to `[0, sigmaCap]`. The centre is
 * untouched. (The wall no longer caps σ — a side can be wider than its distance
 * to the wall, which the display truncates.)
 */
export function setSpread(
  v: GuessValue,
  targetLeft: number,
  targetRight: number,
  min: number,
  max: number,
): GuessValue {
  const cap = sigmaCap(min, max);
  return {
    center: v.center,
    widthLeft: clamp(targetLeft, 0, cap),
    widthRight: clamp(targetRight, 0, cap),
  };
}

/** Grow (delta > 0) or shrink (delta < 0) both half-widths by `delta`, capped at
 * `sigmaCap`. Used by the wheel and keyboard. */
export function resizeSpread(v: GuessValue, delta: number, min: number, max: number): GuessValue {
  return setSpread(v, v.widthLeft + delta, v.widthRight + delta, min, max);
}

/** Set one side's σ directly (the σ-handle drag / keyboard), capped at `sigmaCap`. */
export function setSigma(
  v: GuessValue,
  side: "lower" | "upper",
  sigma: number,
  min: number,
  max: number,
): GuessValue {
  const s = clamp(sigma, 0, sigmaCap(min, max));
  return side === "lower" ? { ...v, widthLeft: s } : { ...v, widthRight: s };
}

export interface HandlePlacement {
  /** Fraction across the scale `[min, max]` (0 = min, 1 = max), before RTL mirroring. */
  frac: number;
  /** How far the handle has dropped below the rail, 0 (at/inside the wall) → 1 (σ = cap). */
  drop: number;
  /** Whether σ exceeds the wall, so the handle is pinned at the wall and dropped. */
  offScale: boolean;
}

/**
 * Where a σ handle sits. While σ fits inside the scale the handle rides the rail
 * at `center ∓ σ`; once σ passes the wall it pins at the wall and *drops* — the
 * overflow (`σ − wall`) mapped onto `[0, 1]` of the vertical wall-rail, so bigger
 * σ hangs lower. This is what lets σ grow past the wall using vertical space
 * instead of horizontal scroll.
 */
export function handlePlacement(
  side: "lower" | "upper",
  center: number,
  sigma: number,
  min: number,
  max: number,
): HandlePlacement {
  const span = Math.max(1, max - min);
  const wall = side === "lower" ? center - min : max - center;
  if (sigma <= wall) {
    const value = side === "lower" ? center - sigma : center + sigma;
    return { frac: (value - min) / span, drop: 0, offScale: false };
  }
  const capOverflow = Math.max(1, sigmaCap(min, max) - wall);
  return {
    frac: side === "lower" ? 0 : 1,
    drop: clamp((sigma - wall) / capOverflow, 0, 1),
    offScale: true,
  };
}

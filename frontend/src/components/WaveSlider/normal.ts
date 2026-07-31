/**
 * The bell the WaveSlider draws (WP-08).
 *
 * A guess `{ center, widthLeft, widthRight }` is visualized as a *split normal*:
 * a bell peaked at `center` whose left half uses `widthLeft` as its σ and right
 * half `widthRight`, so an asymmetric guess draws an asymmetric bell. The curve
 * is truncated at the scale walls — near a wall it becomes a half-bell leaning on
 * it, which is exactly how "society is decided on this" should read.
 *
 * Pure and side-effect free: the component turns {@link bellGeometry} into an
 * SVG `<path>`. The backend scores the matching truncated split-normal, so what
 * a player sees is the shape they're scored on.
 */
import type { GuessValue } from "./interval-model";

/** σ never drops below this, so a zero-width (maximally confident) guess draws a
 * sharp-but-finite spike instead of dividing by zero. */
export const MIN_SIGMA = 2;

/** Unnormalized split-normal density (peak = 1 at `center`) at `x`. */
export function bellDensity(
  x: number,
  center: number,
  sigmaLeft: number,
  sigmaRight: number,
): number {
  const sigma = Math.max(x <= center ? sigmaLeft : sigmaRight, MIN_SIGMA);
  const z = (x - center) / sigma;
  return Math.exp(-0.5 * z * z);
}

export interface BellGeometry {
  /** SVG path `d` for the filled area under the bell (baseline at `height`). */
  area: string;
  /** SVG path `d` for just the top curve, for a crisp outline stroke. */
  line: string;
  /** SVG x of the peak (the centre), for the peak marker line. */
  peakX: number;
}

/**
 * Build the bell as an SVG area path inside a `width`×`height` viewBox. `x` runs
 * left→right for `ltr` and right→left for `rtl`; `y = 0` is the peak, `y =
 * height` the baseline. Peak-normalized (peak touches the top) so the bell always
 * fills the band — its *spread*, not its height, encodes confidence.
 */
export function bellGeometry(
  guess: GuessValue,
  min: number,
  max: number,
  width: number,
  height: number,
  dir: "ltr" | "rtl" = "ltr",
  samples = 96,
): BellGeometry {
  const span = max - min || 1;
  const toX = (value: number) => {
    const frac = (value - min) / span;
    return (dir === "rtl" ? 1 - frac : frac) * width;
  };
  const yOf = (density: number) => height * (1 - density);

  const points: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const value = min + (span * i) / samples;
    const density = bellDensity(value, guess.center, guess.widthLeft, guess.widthRight);
    points.push(`${toX(value).toFixed(2)},${yOf(density).toFixed(2)}`);
  }
  const line = `M ${points.join(" L ")}`;
  // Close the polygon down to the baseline at both ends for a filled area.
  const area = `M ${toX(min).toFixed(2)},${height} L ${points.join(" L ")} L ${toX(max).toFixed(2)},${height} Z`;
  return { area, line, peakX: toX(guess.center) };
}

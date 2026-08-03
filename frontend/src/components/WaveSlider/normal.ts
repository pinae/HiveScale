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

/** Floor on σ for the *mass* discretization — matches the backend scorer's
 * `_MIN_SIGMA`, so the reveal curve equals the shape the guess is scored on. */
const MASS_MIN_SIGMA = 1;

/** erf via Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

const normalCdf = (x: number, mu: number, sigma: number) =>
  0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));

/**
 * Discretize a guess's truncated split-normal into `buckets` probability masses
 * summing to 1 — the exact port of the backend's `split_normal_histogram`. The
 * reveal draws this (not the peak-normalized {@link bellGeometry}) so the
 * player's curve and the crowd's normalized belief histogram share one vertical
 * scale and coincide when the guess matches the crowd — the very thing
 * `belief_match` scores.
 */
export function splitNormalMasses(
  center: number,
  widthLeft: number,
  widthRight: number,
  buckets = 20,
  scaleMax = 100,
): number[] {
  const mode = Math.min(Math.max(center, 0), scaleMax);
  const sl = Math.max(widthLeft, MASS_MIN_SIGMA);
  const sr = Math.max(widthRight, MASS_MIN_SIGMA);
  const zLeft = sl * (0.5 - normalCdf(0, mode, sl));
  const zRight = sr * (normalCdf(scaleMax, mode, sr) - 0.5);
  const z = zLeft + zRight;
  const cdf = (x: number): number => {
    if (x <= 0) return 0;
    if (x >= scaleMax) return 1;
    if (z <= 0) return x < mode ? 0 : 1; // degenerate: point mass at the mode
    const g =
      x <= mode
        ? sl * (normalCdf(x, mode, sl) - normalCdf(0, mode, sl))
        : zLeft + sr * (normalCdf(x, mode, sr) - 0.5);
    return Math.min(1, Math.max(0, g / z));
  };
  const bucketW = scaleMax / buckets;
  const edges = Array.from({ length: buckets + 1 }, (_, i) => cdf(i * bucketW));
  return Array.from({ length: buckets }, (_, i) => edges[i + 1] - edges[i]);
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

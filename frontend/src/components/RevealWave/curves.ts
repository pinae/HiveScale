/**
 * Turn a crowd histogram into a smooth SVG curve for the reveal overlay (WP-09).
 *
 * The bars show the distribution of players' *mean* placements; this draws the
 * *summed beliefs* (every player's full split-normal, added up) as a smooth curve
 * on the same vertical scale, so the two read as "the spiky means and their
 * smooth envelope". Pure string builder — no dependency, trivially testable.
 */

export interface CurvePaths {
  /** Open path `d` through the bucket tops, for the stroke. */
  line: string;
  /** Closed path `d` down to the baseline, for a faint fill. */
  area: string;
}

/**
 * Build the curve in a `width`×`height` viewBox. Heights are scaled by
 * `maxValue` (pass the bars' max so bars and curve share one scale); a bucket
 * taller than `maxValue` is clamped to the top.
 */
export function histogramCurve(
  histogram: number[],
  width: number,
  height: number,
  maxValue: number,
): CurvePaths {
  const n = histogram.length || 1;
  const bucketW = width / n;
  const yOf = (value: number) =>
    height * (1 - (maxValue > 0 ? Math.min(1, value / maxValue) : 0));
  const points = histogram.map(
    (value, i) => `${((i + 0.5) * bucketW).toFixed(2)},${yOf(value).toFixed(2)}`,
  );
  const line = `M ${points.join(" L ")}`;
  // Anchor both ends at the baseline so the fill closes cleanly across the width.
  const area = `M 0,${height} L ${points.join(" L ")} L ${width.toFixed(2)},${height} Z`;
  return { line, area };
}

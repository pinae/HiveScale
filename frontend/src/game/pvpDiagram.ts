/**
 * Geometry for the end-of-match arrow-chain diagram.
 *
 * Each answered round contributes a vector `(means_match, belief_match)` — both
 * 0–1 — and the vectors are laid tip-to-tail from the origin, so a player's
 * match reads as a path across a square whose axes are the two match qualities.
 * A perfect match would march straight up the diagonal to the far corner; real
 * play winds, leaning toward whichever quality that player reads better.
 *
 * The winner is whoever's chain ends nearest the top-right corner, measured by
 * `x + y` — the same quantity the backend uses, so the two never disagree.
 */

export interface ChainVector {
  index: number;
  means_match: number;
  belief_match: number;
}

export interface ChainPoint {
  x: number;
  y: number;
}

/** Tip-to-tail points, starting at the origin: n vectors → n+1 points. */
export function chainPoints(vectors: readonly ChainVector[]): ChainPoint[] {
  const points: ChainPoint[] = [{ x: 0, y: 0 }];
  let x = 0;
  let y = 0;
  for (const v of vectors) {
    x += v.means_match;
    y += v.belief_match;
    points.push({ x, y });
  }
  return points;
}

/** Where a chain ends — its total (means, belief) reach. */
export function chainEnd(vectors: readonly ChainVector[]): ChainPoint {
  const points = chainPoints(vectors);
  return points[points.length - 1];
}

/** How far a chain reached toward the top-right corner. */
export function reach(end: ChainPoint): number {
  return end.x + end.y;
}

export type Winner = "you" | "opponent" | "tie";

/** Who got nearest the top-right corner. Ties are real (identical reach). */
export function winnerOf(
  yours: readonly ChainVector[],
  theirs: readonly ChainVector[],
): Winner {
  const mine = reach(chainEnd(yours));
  const other = reach(chainEnd(theirs));
  if (Math.abs(mine - other) < 1e-9) return "tie";
  return mine > other ? "you" : "opponent";
}

/**
 * Map chain points into an SVG viewBox where y grows *upward* (a maths diagram,
 * not screen coordinates). `size` is the drawable square's side in viewBox units
 * and `rounds` sets the axis maximum, so a full match spans the whole square.
 */
export function toSvgPoints(
  points: readonly ChainPoint[],
  size: number,
  rounds: number,
  originX = 0,
  originY = size,
): { x: number; y: number }[] {
  const span = Math.max(1, rounds);
  return points.map((p) => ({
    x: originX + (p.x / span) * size,
    y: originY - (p.y / span) * size,
  }));
}

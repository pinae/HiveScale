/**
 * Reveal flavour logic (WP-09, plan §2.1): classify how a round went and pick a
 * matching quip. Pure and deterministic so stories and tests are stable, and so
 * "losing is entertaining" — the confidently-wrong lines are the funniest.
 */

export type OutcomeClass =
  | "nailed"
  | "confidently-wrong"
  | "cowardly-wide"
  | "contrarian"
  | "pioneer";

export interface GuessGeometry {
  center: number;
  widthLeft: number;
  widthRight: number;
}

const NEAR = 8; // within this of the median counts as a hit
const FAR = 18; // beyond this counts as a miss
const TIGHT = 14; // interval this narrow is a confident bet
const WIDE = 45; // interval this broad is playing it safe

/** Classify a round. A `null` median means the pairing had no crowd yet. */
export function classifyOutcome(median: number | null, guess: GuessGeometry): OutcomeClass {
  if (median === null) return "pioneer";
  const distance = Math.abs(guess.center - median);
  const width = guess.widthLeft + guess.widthRight;

  if (width >= WIDE) return "cowardly-wide";
  if (distance >= FAR && width <= TIGHT) return "confidently-wrong";
  if (distance >= FAR) return "contrarian";
  if (distance <= NEAR) return "nailed";
  return distance <= 12 ? "nailed" : "contrarian";
}

const QUIPS: Record<OutcomeClass, readonly string[]> = {
  nailed: ["Bang on the hive mind.", "You *are* the baseline.", "Society nods in agreement."],
  "confidently-wrong": [
    "Bold. Wrong, but bold.",
    "Confidently sailing the wrong way.",
    "The conviction! The inaccuracy!",
  ],
  "cowardly-wide": [
    "Casting a wide net, I see.",
    "Technically not wrong about anything.",
    "A brave refusal to commit.",
  ],
  contrarian: [
    "Marching to your own drum.",
    "Society went left; you went right.",
    "A true independent thinker.",
  ],
  pioneer: [
    "First one in — plant the flag.",
    "Nobody's been here yet. You're the scout.",
    "Charting unmapped waters.",
  ],
};

/** Deterministically pick a quip for an outcome, cycling by `seed`. */
export function pickQuip(outcome: OutcomeClass, seed = 0): string {
  const lines = QUIPS[outcome];
  return lines[((seed % lines.length) + lines.length) % lines.length];
}

/**
 * How many scale points closer to the crowd median the player was than the AI.
 * Positive means the human beat the bot.
 */
export function beatMargin(median: number, guessCenter: number, aiMedian: number): number {
  return Math.round(Math.abs(aiMedian - median) - Math.abs(guessCenter - median));
}

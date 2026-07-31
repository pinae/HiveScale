import type { Page } from "@playwright/test";

/**
 * Mock the game API at the network layer so e2e runs need no backend. Each
 * handler mirrors the OpenAPI contract the frontend types against (see
 * src/api/client.ts). Call once per test before navigating.
 */

export const roundA = {
  pairing_id: 1,
  thing: { text: "Robotic lawnmower" },
  scale: { left: "sophisticated", right: "overly complicated" },
  round_token: "tokA",
};

export const roundB = {
  pairing_id: 2,
  thing: { text: "Pineapple pizza" },
  scale: { left: "disgusting", right: "delightful" },
  round_token: "tokB",
};

/** A normalized 20-bucket histogram peaked around the crowd median (~52). */
const crowdHistogram = Array.from({ length: 20 }, (_, i) =>
  Math.exp(-((i - 10) ** 2) / 6),
);
/** The crowd's summed beliefs: a wider, smoother version of the means. */
const beliefHistogram = Array.from({ length: 20 }, (_, i) =>
  Math.exp(-((i - 10) ** 2) / 16),
);

export const humanReveal = (counted = true) => ({
  source: "human" as const,
  counted,
  score: { total: 812, means_match: 0.74, belief_match: 0.68, good_match: true },
  crowd: {
    histogram: crowdHistogram,
    belief_histogram: beliefHistogram,
    median: 52, q25: 44, q75: 60, n: 30,
  },
  percentile: 76,
  bimodal: false,
  streak: { hot: counted ? 3 : 0 },
  // Level 1 keeps the UI mechanics suite free of the level-up explainer card,
  // which belongs to the progression tests, not the loop-mechanics ones.
  player: { xp: counted ? 812 : 0, level: 1 },
});

/**
 * Install the happy-path round loop: session start, roundA until the player
 * guesses, then roundB, and a human reveal on guess. The state is keyed on
 * whether a guess has happened (not on call count) so it stays deterministic
 * under React StrictMode's double-invoked boot effect in dev.
 */
export async function mockGameLoop(page: Page): Promise<void> {
  let guessed = false;

  await page.route("**/api/session/", (route) =>
    route.fulfill({ json: { player: { level: 1, xp: 0, is_claimed: false }, created: true } }),
  );

  // Regex, not a glob: the client appends a `?exclude=…` recently-seen list on
  // later deals, which a trailing-slash glob would fail to match.
  await page.route(/\/api\/round\/next\//, (route) =>
    route.fulfill({ json: guessed ? roundB : roundA }),
  );

  await page.route("**/api/round/guess/", (route) => {
    guessed = true;
    return route.fulfill({ json: humanReveal(true) });
  });
}

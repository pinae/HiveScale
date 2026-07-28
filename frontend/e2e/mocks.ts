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

export const humanReveal = (counted = true) => ({
  source: "human" as const,
  counted,
  score: { total: 812, distance_points: 560, calibration_points: 252, covered_fraction: 0.7 },
  crowd: { histogram: crowdHistogram, median: 52, q25: 44, q75: 60, n: 30 },
  percentile: 76,
  bimodal: false,
  streak: { hot: counted ? 3 : 0 },
  player: { xp: counted ? 812 : 0, level: 2 },
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

  await page.route("**/api/round/next/", (route) =>
    route.fulfill({ json: guessed ? roundB : roundA }),
  );

  await page.route("**/api/round/guess/", (route) => {
    guessed = true;
    return route.fulfill({ json: humanReveal(true) });
  });
}

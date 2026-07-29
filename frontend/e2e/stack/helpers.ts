import { expect, type Page } from "@playwright/test";

/** Mirrors backend `core.services.SPEED_FLOOR_MS`: guesses faster than this are
 * flagged too-fast and earn nothing (plan §1.7). */
export const SPEED_FLOOR_MS = 1500;

/** The submit control; its presence also signals a round is dealt and playable. */
export function submitButton(page: Page) {
  return page.getByRole("button", { name: /lock it in/i });
}

/** Resolve once a fresh round has been dealt and is answerable. */
export async function waitForRound(page: Page) {
  await expect(submitButton(page)).toBeVisible();
}

/** The current session XP as a number (0 for a brand-new anonymous player). */
export async function sessionXp(page: Page): Promise<number> {
  return Number(await page.getByTestId("session-xp").textContent());
}

/** Dismiss a level-up explainer card if one is currently on screen. */
export async function dismissLevelUp(page: Page) {
  const gotIt = page.getByRole("button", { name: /got it/i });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
}

/**
 * Play the current round as a *counted* answer: dwell past the server's speed
 * floor so the reveal isn't flagged too-fast, submit, and wait for the reveal.
 * Clears any unlock card the round may have popped so the loop stays clickable.
 */
export async function playCountedRound(page: Page) {
  await waitForRound(page);
  await page.waitForTimeout(SPEED_FLOOR_MS + 300);
  await submitButton(page).click();
  await expect(page.getByRole("region", { name: /reveal/i })).toBeVisible();
  await dismissLevelUp(page);
}

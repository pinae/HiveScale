import { expect, test } from "@playwright/test";

import { SPEED_FLOOR_MS, playCountedRound, sessionXp, submitButton, waitForRound } from "./helpers";

/**
 * WP-12 integration suite: the real Django backend (seeded sqlite, Gemini faked)
 * behind the actual Vite dev proxy. These assert behaviours a mock can't vouch
 * for — most importantly the blind-deal guarantee, which *is* the dataset's
 * integrity (plan §1.5) and is meaningless unless the real server is answering.
 *
 * The deal is nondeterministic (the scheduler picks the pairing), so assertions
 * hold for any dealt round: XP accumulates, no distribution leaks, the speed
 * floor bites, the keyboard works, the stats page renders.
 */
test.describe("real backend game loop", () => {
  test("completes three rounds and accumulates score", async ({ page }) => {
    await page.goto("/");
    await waitForRound(page);
    expect(await sessionXp(page)).toBe(0);

    for (let round = 0; round < 3; round++) {
      await playCountedRound(page);
      if (round < 2) {
        await page.getByRole("button", { name: /next round/i }).click();
        await waitForRound(page);
      }
    }

    // Three counted rounds each bank points (a human score or the pioneer bonus).
    expect(await sessionXp(page)).toBeGreaterThan(0);
  });

  test("the deal is blind: no distribution data reaches the client before the guess", async ({
    page,
  }) => {
    const deals: Record<string, unknown>[] = [];
    page.on("response", async (res) => {
      if (res.url().includes("/api/round/next/") && res.request().method() === "GET") {
        try {
          deals.push(await res.json());
        } catch {
          /* non-JSON error responses are irrelevant to the guarantee */
        }
      }
    });

    await page.goto("/");
    await waitForRound(page);

    expect(deals.length).toBeGreaterThan(0);
    for (const body of deals) {
      // The deal carries exactly the round's identity — never the crowd.
      expect(Object.keys(body).sort()).toEqual(["pairing_id", "round_token", "scale", "thing"]);
      for (const leak of ["histogram", "median", "q25", "q75", "n", "crowd", "score", "percentile", "ai_estimate"]) {
        expect(body).not.toHaveProperty(leak);
      }
    }

    // Nothing crowd-shaped is on screen until the player commits...
    await expect(page.getByRole("region", { name: /reveal/i })).toHaveCount(0);
    await playCountedRound(page);
    // ...and only then is the distribution revealed.
    await expect(page.getByRole("region", { name: /reveal/i })).toBeVisible();
  });

  test("the server-side speed floor flags an instant guess", async ({ page }) => {
    await page.goto("/");
    await waitForRound(page);

    // Submit immediately — well under the 1.5s floor the server enforces from
    // the signed deal timestamp, so no client clock can fake a legit dwell.
    await submitButton(page).click();

    await expect(page.getByRole("alert")).toContainText(/too fast/i);
    expect(await sessionXp(page)).toBe(0);
  });

  test("a round is fully playable with the keyboard alone", async ({ page }) => {
    await page.goto("/");
    await waitForRound(page);

    const thumb = page.getByRole("slider", { name: "Your guess" });
    await thumb.focus();
    const before = Number(await thumb.getAttribute("aria-valuenow"));
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(Number(await thumb.getAttribute("aria-valuenow"))).toBe(before + 3);

    // Dwell past the floor, then tab to the submit button and activate it.
    await page.waitForTimeout(SPEED_FLOOR_MS + 300);
    await page.keyboard.press("Tab");
    await expect(submitButton(page)).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("region", { name: /reveal/i })).toBeVisible();
  });

  test("saving progress after a reveal preserves the accumulated score", async ({ page }) => {
    await page.goto("/");
    await playCountedRound(page);
    const earned = await sessionXp(page);
    expect(earned).toBeGreaterThan(0);

    // Claim the anonymous session by email (dev "echo" delivery returns the
    // token inline, so we can confirm without a real inbox).
    await page.getByRole("button", { name: /save progress/i }).click();
    await page.getByLabel(/email/i).fill(`e2e-${Date.now()}@example.com`);
    await page.getByRole("button", { name: /magic link/i }).click();
    await page.getByRole("button", { name: /confirm now/i }).click();

    // The session is now saved and the score carried across the claim intact.
    await expect(page.getByTestId("session-saved")).toBeVisible();
    expect(await sessionXp(page)).toBe(earned);
  });

  test("completes the Daily Wave and copies the share string to the clipboard", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await waitForRound(page);

    await page.getByRole("button", { name: /daily/i }).click();

    // Play every slot. Speed doesn't matter here — the wave still completes and
    // grades — so answer straight through rather than dwelling each time.
    const emoji = page.getByTestId("wave-result-emoji");
    for (let i = 0; i < 15; i++) {
      await page.getByRole("button", { name: /lock it in/i }).click();
      await page.getByRole("button", { name: /next slot|see your result/i }).click();
      if (await emoji.isVisible().catch(() => false)) break;
    }

    await expect(emoji).toBeVisible();
    await page.getByRole("button", { name: /copy result/i }).click();
    await expect(page.getByText(/result copied/i)).toBeVisible();

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain("HiveScale");
  });

  test("curates a pairing by voting (unlocked for the e2e player)", async ({ page }) => {
    await page.goto("/");
    await waitForRound(page);

    // The e2e backend lowers the vote gate, so the entry is present.
    await page.getByRole("button", { name: /vote/i }).click();

    // Judge whatever combo is served; the verdict produces an outcome message.
    await expect(page.getByRole("button", { name: /fun/i })).toBeVisible();
    await page.getByRole("button", { name: /interesting/i }).click();
    await expect(page.getByText(/added|retired|vote counted|noted/i)).toBeVisible();

    await page.getByRole("button", { name: /back to the game/i }).click();
    await waitForRound(page);
  });

  test("completes a thing challenge and banks the bonus XP", async ({ page }) => {
    await page.goto("/");
    await waitForRound(page);
    const before = await sessionXp(page);

    await page.getByRole("button", { name: /challenge/i }).click();
    await page.getByLabel(/your thing/i).fill(`e2e thing ${Date.now() % 100000}`);
    await page.getByRole("button", { name: /submit for/i }).click();

    await expect(page.getByText(/in the pool for review/i)).toBeVisible();
    await page.getByRole("button", { name: /back to the game/i }).first().click();

    await waitForRound(page);
    // The flat challenge bonus (25k) is now folded into the running XP.
    expect(await sessionXp(page)).toBeGreaterThan(before);
  });

  test("the stats page shows a real archetype and returns to the game", async ({ page }) => {
    await page.goto("/");
    await waitForRound(page);

    await page.getByRole("button", { name: /^stats$/i }).click();
    await expect(page.getByTestId("archetype-name")).not.toBeEmpty();

    await page.getByRole("button", { name: /back to the game/i }).click();
    await waitForRound(page);
  });
});

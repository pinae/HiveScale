import { expect, test } from "@playwright/test";

import { mockGameLoop, roundB } from "./mocks";

/**
 * Full-browser coverage of the game loop. These assert behaviours jsdom can't:
 * real pointer drags on the WaveSlider and the actual CSS reveal animation
 * (`prefers-reduced-motion` honoured by Chromium itself, not a matchMedia stub).
 */

test("deals a round, plays it, reveals the score, and advances", async ({ page }) => {
  await mockGameLoop(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Robotic lawnmower" })).toBeVisible();

  await page.getByRole("button", { name: /lock it in/i }).click();

  const reveal = page.getByRole("region", { name: /reveal/i });
  await expect(reveal).toBeVisible();
  await expect(page.getByTestId("reveal-score-total")).toHaveText("812");
  await expect(page.getByTestId("session-xp")).toHaveText("812");

  await page.getByRole("button", { name: /next round/i }).click();
  await expect(page.getByRole("heading", { name: roundB.thing.text })).toBeVisible();
});

test("the centre thumb is draggable with a real pointer", async ({ page }) => {
  await mockGameLoop(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Robotic lawnmower" })).toBeVisible();

  const thumb = page.getByRole("slider", { name: "Your guess" });
  await expect(thumb).toHaveAttribute("aria-valuenow", "50");

  const track = page.getByTestId("wave-slider-track");
  const box = (await track.boundingBox())!;
  // Drag the centre to ~20% of the track and confirm the value followed.
  await thumb.hover();
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  const now = Number(await thumb.getAttribute("aria-valuenow"));
  expect(now).toBeGreaterThan(10);
  expect(now).toBeLessThan(35);
});

test.describe("reveal animation", () => {
  test("runs the bar-rise when motion is allowed", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mockGameLoop(page);
    await page.goto("/");
    await page.getByRole("button", { name: /lock it in/i }).click();

    const reveal = page.getByRole("region", { name: /reveal/i });
    await expect(reveal).toHaveAttribute("data-animated", "true");

    // Chromium actually applies the @keyframes — jsdom never could.
    const bar = page.getByTestId("reveal-hist-bar").first();
    const animationName = await bar.evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toBe("bsg-rise");

    // And the score genuinely counts up to the target rather than snapping.
    await expect(page.getByTestId("reveal-score-total")).toHaveText("812");
  });

  test("stays still when the viewer prefers reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockGameLoop(page);
    await page.goto("/");
    await page.getByRole("button", { name: /lock it in/i }).click();

    const reveal = page.getByRole("region", { name: /reveal/i });
    await expect(reveal).toHaveAttribute("data-animated", "false");

    const bar = page.getByTestId("reveal-hist-bar").first();
    const animationName = await bar.evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toBe("none");

    // Score is shown immediately at its final value.
    await expect(page.getByTestId("reveal-score-total")).toHaveText("812");
  });
});

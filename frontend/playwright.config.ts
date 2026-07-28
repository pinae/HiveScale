import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the built SPA in a real Chromium and mock the backend at
 * the network layer (page.route), so they need no Django/Postgres/Redis. They
 * cover what jsdom can't: real pointer drags on the WaveSlider and the CSS
 * reveal animation (`prefers-reduced-motion` honoured for real).
 *
 * Browser resolution, in order:
 *   1. $PLAYWRIGHT_CHROMIUM_PATH — a system-installed Chromium/Chrome binary.
 *      Use this when `playwright install` can't provide a build for your OS
 *      (e.g. Ubuntu 26.04): `PLAYWRIGHT_CHROMIUM_PATH=$(which chromium) yarn e2e`.
 *   2. Otherwise Playwright's own build (1.56 bundles Chromium 1194), which the
 *      container pre-installs under $PLAYWRIGHT_BROWSERS_PATH. On a fresh clone,
 *      run `yarn playwright install chromium` once.
 */
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
  ],
  webServer: {
    command: "yarn dev --port 5173",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

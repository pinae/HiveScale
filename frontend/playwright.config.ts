import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (WP-12). Two suites share one browser:
 *
 * - `e2e/ui/`    — fast UI mechanics with the API mocked at the network layer
 *                  (page.route): real pointer drags, the CSS reveal animation,
 *                  `prefers-reduced-motion` honoured by Chromium itself.
 * - `e2e/stack/` — integration against the *real* Django backend (sqlite, seeded,
 *                  Gemini faked): the blind-deal guarantee, xp accumulation, the
 *                  server-side speed floor, keyboard-only play, and the stats page.
 *
 * Both webServers boot automatically. The backend runs on an isolated sqlite DB
 * it reseeds on start, so runs are deterministic and never touch the dev db.
 *
 * Browser resolution, in order:
 *   1. $PLAYWRIGHT_CHROMIUM_PATH — a system-installed Chromium/Chrome binary.
 *      Use this when `playwright install` has no build for your OS (e.g. Ubuntu
 *      26.04): `PLAYWRIGHT_CHROMIUM_PATH=$(which chromium) yarn e2e`.
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
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    // Dedicated ports (5174/8001) so the e2e stack never collides with — or
    // silently reuses — a dev/prod stack you may have running on 5173/8000.
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
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
  webServer: [
    {
      // Real backend for the e2e/stack suite: migrate + reseed an isolated
      // sqlite DB, then serve. Gemini is faked (no key), Redis isn't needed
      // (cold-start enqueue is best-effort), so this is self-contained.
      command:
        "uv run python manage.py migrate --noinput && " +
        "uv run python manage.py seed_demo --reset && " +
        // --nothreading serialises requests so parallel workers never hit a
        // SQLite write lock; --noreload keeps it a single killable process.
        "uv run python manage.py runserver 8001 --noreload --nothreading",
      cwd: "../backend",
      url: "http://localhost:8001/api/health/",
      env: {
        DATABASE_URL: "sqlite:///e2e-db.sqlite3",
        DJANGO_SECRET_KEY: "e2e-insecure-key",
        GEMINI_API_KEY: "",
        // Unlock the level-gated features for a fresh player so the flows are
        // e2e-testable without grinding to the real levels.
        CONTENT_DAILY_WAVE_LEVEL: "1",
        CONTENT_VOTE_LEVEL: "1",
        CONTENT_CHALLENGE_LEVEL: "1",
        CONTENT_SCALE_LEVEL: "1",
        CONTENT_SCALE_MIN_ROUNDS: "0",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "yarn dev --port 5174",
      url: "http://localhost:5174",
      // Proxy /api to the e2e backend (8001), not the default dev target (8000).
      env: { VITE_API_PROXY_TARGET: "http://localhost:8001" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

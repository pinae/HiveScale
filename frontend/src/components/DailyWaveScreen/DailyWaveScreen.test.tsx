/**
 * WP-11/12: the Daily Wave loop (against MSW) — play every slot, watch the emoji
 * progress fill, and land on the shareable result.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import DailyWaveScreen from "./DailyWaveScreen";
import { server } from "../../test/server";

const slot = (index: number) => ({
  index,
  pairing_id: index + 1,
  thing: { text: index === 0 ? "Pineapple pizza" : "Fax machine" },
  scale: { left: "disgusting", right: "delightful" },
  wave_token: `tok-${index}`,
});

const reveal = (wave: unknown) => ({
  source: "human",
  counted: true,
  score: { total: 800, distance_points: 500, calibration_points: 300, covered_fraction: 0.7 },
  crowd: { histogram: Array(20).fill(0.05), median: 50, q25: 42, q75: 58, n: 30 },
  percentile: 70,
  bimodal: false,
  streak: { hot: 1 },
  player: { xp: 800, level: 1 },
  wave,
});

// Reveal animations settle instantly under reduced motion — keep tests sync.
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});
afterEach(() => {
  // @ts-expect-error jsdom has no matchMedia by default.
  delete window.matchMedia;
});

describe("DailyWaveScreen", () => {
  it("plays the wave to completion and shows the shareable result", async () => {
    let answered = 0;
    server.use(
      http.get("/api/daily-wave/", () =>
        HttpResponse.json({
          date: "2026-07-28",
          total: 2,
          answered: 0,
          completed: false,
          results: [],
          score: 0,
          next: slot(0),
          daily_streak: 2,
          share_string: null,
        }),
      ),
      http.post("/api/daily-wave/guess/", () => {
        answered += 1;
        const completed = answered === 2;
        return HttpResponse.json(
          reveal({
            date: "2026-07-28",
            total: 2,
            answered,
            completed,
            results: answered === 1 ? ["🎯"] : ["🎯", "🌊"],
            score: answered * 800,
            next: completed ? null : slot(1),
            daily_streak: 2,
            share_string: completed ? "HiveScale 2026-07-28\n🎯🌊\n1600 pts · 🔥2" : null,
          }),
        );
      }),
    );
    const user = userEvent.setup();
    render(<DailyWaveScreen />);

    expect(await screen.findByRole("heading", { name: "Pineapple pizza" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /lock it in/i }));
    await user.click(await screen.findByRole("button", { name: /next slot/i }));

    expect(await screen.findByRole("heading", { name: "Fax machine" })).toBeInTheDocument();
    expect(screen.getByTestId("wave-progress")).toHaveTextContent("1 / 2");
    await user.click(screen.getByRole("button", { name: /lock it in/i }));
    await user.click(await screen.findByRole("button", { name: /see your result/i }));

    expect(await screen.findByTestId("wave-result-emoji")).toHaveTextContent("🎯🌊");
    expect(screen.getByTestId("wave-result-score")).toHaveTextContent("1600");
  });

  it("opens straight to the result when the wave is already done", async () => {
    server.use(
      http.get("/api/daily-wave/", () =>
        HttpResponse.json({
          date: "2026-07-28",
          total: 2,
          answered: 2,
          completed: true,
          results: ["🎯", "🌊"],
          score: 1600,
          next: null,
          daily_streak: 2,
          share_string: "HiveScale 2026-07-28\n🎯🌊\n1600 pts · 🔥2",
        }),
      ),
    );
    render(<DailyWaveScreen />);
    expect(await screen.findByTestId("wave-result-emoji")).toHaveTextContent("🎯🌊");
  });
});

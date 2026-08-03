/**
 * StatsPanel renders the archetype identity and calibration numbers.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import StatsPanel from "./StatsPanel";
import type { Stats } from "../../api/client";

const stats: Stats = {
  archetype: { name: "Oracle", blurb: "Tight and right — the crowd whisperer." },
  calibration: { n: 12, hit_rate: 0.7, mean_width: 22 },
  streaks: { hot: 3, daily: 5, freezes: 1 },
  xp: 3200,
  level: 4,
};

describe("StatsPanel", () => {
  it("shows the archetype and calibration summary", () => {
    render(<StatsPanel stats={stats} />);
    expect(screen.getByTestId("archetype-name")).toHaveTextContent("Oracle");
    expect(screen.getByText(/crowd whisperer/i)).toBeInTheDocument();
    expect(screen.getByTestId("stats-coverage")).toHaveTextContent("70%");
    expect(screen.getByText(/over 12 scored rounds/i)).toBeInTheDocument();
  });

  it("prompts newcomers with no scored rounds", () => {
    render(<StatsPanel stats={{ ...stats, calibration: { n: 0, hit_rate: 0, mean_width: 0 } }} />);
    expect(screen.getByText(/play a few rounds/i)).toBeInTheDocument();
  });
});

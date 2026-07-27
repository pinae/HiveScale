/**
 * WP-09 red tests: ScorePanel — the count-up total, breakdown, percentile, quip.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ScorePanel from "./ScorePanel";

const score = {
  total: 853,
  distance_points: 600,
  calibration_points: 253,
  covered_fraction: 0.71,
};

describe("ScorePanel", () => {
  it("shows the final total, breakdown, percentile and quip (no animation)", () => {
    render(
      <ScorePanel
        score={score}
        percentile={83}
        outcome="nailed"
        quip="Bullseye."
        animate={false}
      />,
    );
    expect(screen.getByTestId("reveal-score-total")).toHaveTextContent("853");
    expect(screen.getByText(/600/)).toBeInTheDocument();
    expect(screen.getByText(/253/)).toBeInTheDocument();
    expect(screen.getByText(/83%/)).toBeInTheDocument();
    expect(screen.getByText("Bullseye.")).toBeInTheDocument();
  });
});

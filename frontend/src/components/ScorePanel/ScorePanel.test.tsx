/**
 * WP-09 red tests: ScorePanel — the count-up total, breakdown, percentile, quip.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ScorePanel from "./ScorePanel";

const score = {
  total: 853,
  means_match: 0.78,
  belief_match: 0.71,
  good_match: true,
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
    expect(screen.getByText(/78%/)).toBeInTheDocument(); // means match
    expect(screen.getByText(/71%/)).toBeInTheDocument(); // belief match
    expect(screen.getByText(/83%/)).toBeInTheDocument(); // percentile
    expect(screen.getByText("Bullseye.")).toBeInTheDocument();
  });
});

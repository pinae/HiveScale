/**
 * WP-09 red tests: RevealWave — the emotional payoff moment.
 *
 * Spec (plan §2.1/§2.4/WP-09): the crowd histogram, the player's marker, a
 * count-up score whose final numbers match the payload, a percentile stinger,
 * an outcome quip, a bimodality celebration, the optional "beat the bot"
 * overlay, the pioneer variant, and a reduced-motion path.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import RevealWave from "./RevealWave";
import type { HumanReveal, PioneerReveal } from "../api/reveal";

const crowdHistogram = Array.from({ length: 20 }, (_, i) => (i >= 8 && i <= 12 ? 0.2 : 0));

const humanReveal: HumanReveal = {
  source: "human",
  counted: true,
  score: { total: 853, distance_points: 600, calibration_points: 253, covered_fraction: 0.71 },
  crowd: { histogram: crowdHistogram, median: 52, q25: 41, q75: 64, n: 23 },
  percentile: 83,
  bimodal: false,
  streak: { hot: 3 },
  player: { xp: 4212, level: 2 },
};

const guess = { center: 52, widthLeft: 12, widthRight: 12 };

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

afterEach(() => {
  // @ts-expect-error jsdom has no matchMedia by default; reset between tests.
  delete window.matchMedia;
});

describe("RevealWave (human)", () => {
  it("shows the final score numbers and the percentile stinger", () => {
    render(<RevealWave reveal={humanReveal} guess={guess} animate={false} />);
    expect(screen.getByTestId("reveal-score-total")).toHaveTextContent("853");
    expect(screen.getByText(/83%/)).toBeInTheDocument();
  });

  it("renders the 20-bucket crowd histogram", () => {
    render(<RevealWave reveal={humanReveal} guess={guess} animate={false} />);
    expect(screen.getAllByTestId("reveal-hist-bar")).toHaveLength(20);
  });

  it("celebrates bimodality only when the crowd is split", () => {
    const { unmount } = render(<RevealWave reveal={humanReveal} guess={guess} animate={false} />);
    expect(screen.queryByText(/at war/i)).not.toBeInTheDocument();
    unmount();
    render(
      <RevealWave reveal={{ ...humanReveal, bimodal: true }} guess={guess} animate={false} />,
    );
    expect(screen.getByText(/at war/i)).toBeInTheDocument();
  });

  it("shows a beat-the-bot overlay with the margin when an AI estimate is given", () => {
    render(
      <RevealWave
        reveal={humanReveal}
        guess={guess}
        aiEstimate={{ provisional: false, median: 70, q25: 60, q75: 80, histogram: crowdHistogram }}
        animate={false}
      />,
    );
    expect(screen.getByText(/beat/i)).toBeInTheDocument();
    expect(screen.getByText(/18/)).toBeInTheDocument(); // |70-52| - |52-52|
  });

  it("notes when a round was too quick to count", () => {
    render(
      <RevealWave reveal={{ ...humanReveal, counted: false }} guess={guess} animate={false} />,
    );
    expect(screen.getByText(/too quick|didn.?t count/i)).toBeInTheDocument();
  });

  it("honours prefers-reduced-motion by settling immediately", () => {
    mockReducedMotion(true);
    render(<RevealWave reveal={humanReveal} guess={guess} />); // animate defaults on
    expect(screen.getByTestId("reveal-score-total")).toHaveTextContent("853");
    expect(screen.getByRole("region", { name: /reveal/i })).toHaveAttribute(
      "data-animated",
      "false",
    );
  });
});

describe("RevealWave (pioneer)", () => {
  const pioneer: PioneerReveal = {
    source: "pioneer",
    counted: true,
    pioneer_bonus: 550,
    ai_estimate: null,
    streak: { hot: 0 },
    player: { xp: 550, level: 1 },
  };

  it("pays the pioneer bonus without a crowd or percentile", () => {
    render(<RevealWave reveal={pioneer} guess={{ center: 40, widthLeft: 10, widthRight: 10 }} animate={false} />);
    expect(screen.getByText(/550/)).toBeInTheDocument();
    expect(screen.getByText(/pioneer/i)).toBeInTheDocument();
    expect(screen.queryAllByTestId("reveal-hist-bar")).toHaveLength(0);
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("shows a clearly-labelled provisional AI estimate when present", () => {
    render(
      <RevealWave
        reveal={{
          ...pioneer,
          ai_estimate: { provisional: true, median: 62, q25: 50, q75: 74, histogram: crowdHistogram },
        }}
        guess={{ center: 40, widthLeft: 10, widthRight: 10 }}
        animate={false}
      />,
    );
    expect(screen.getByText(/ai estimate|provisional/i)).toBeInTheDocument();
    expect(screen.getAllByTestId("reveal-hist-bar")).toHaveLength(20);
  });
});

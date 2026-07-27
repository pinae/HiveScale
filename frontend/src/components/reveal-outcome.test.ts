/**
 * WP-09 red tests: outcome classification + flavour quips + beat-the-bot maths.
 */
import { describe, expect, it } from "vitest";

import { beatMargin, classifyOutcome, pickQuip } from "./reveal-outcome";

const g = (center: number, widthLeft: number, widthRight: number) => ({
  center,
  widthLeft,
  widthRight,
});

describe("classifyOutcome", () => {
  it("calls a tight hit near the median 'nailed'", () => {
    expect(classifyOutcome(50, g(50, 12, 12))).toBe("nailed");
  });

  it("calls a tight guess far from the median 'confidently-wrong'", () => {
    expect(classifyOutcome(50, g(80, 5, 5))).toBe("confidently-wrong");
  });

  it("calls a very wide interval 'cowardly-wide' regardless of aim", () => {
    expect(classifyOutcome(50, g(50, 30, 30))).toBe("cowardly-wide");
  });

  it("calls a wide-ish miss 'contrarian'", () => {
    expect(classifyOutcome(50, g(80, 20, 20))).toBe("contrarian");
  });

  it("returns 'pioneer' when there is no crowd median", () => {
    expect(classifyOutcome(null, g(40, 10, 10))).toBe("pioneer");
  });
});

describe("pickQuip", () => {
  it("is deterministic for a given outcome and seed", () => {
    expect(pickQuip("nailed", 0)).toBe(pickQuip("nailed", 0));
  });

  it("returns a non-empty line for every outcome class", () => {
    for (const outcome of [
      "nailed",
      "confidently-wrong",
      "cowardly-wide",
      "contrarian",
      "pioneer",
    ] as const) {
      expect(pickQuip(outcome, 1).length).toBeGreaterThan(0);
    }
  });
});

describe("beatMargin", () => {
  it("is positive when the player is closer to the crowd than the AI", () => {
    // crowd median 52, player at 52 (err 0), AI at 70 (err 18) => beat by 18.
    expect(beatMargin(52, 52, 70)).toBe(18);
  });

  it("is negative when the AI was closer", () => {
    expect(beatMargin(52, 20, 50)).toBe(-30);
  });
});

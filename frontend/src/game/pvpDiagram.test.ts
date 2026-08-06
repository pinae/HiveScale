/**
 * The arrow-chain geometry behind the end-of-match diagram: vectors laid
 * tip-to-tail, and the winner being whoever reached nearest the top-right.
 */
import { describe, expect, it } from "vitest";

import { chainEnd, chainPoints, reach, toSvgPoints, winnerOf } from "./pvpDiagram";

const v = (means: number, belief: number, index = 0) => ({
  index,
  means_match: means,
  belief_match: belief,
});

describe("chainPoints", () => {
  it("starts at the origin and adds one point per round", () => {
    const points = chainPoints([v(0.6, 0.8), v(0.5, 0.3)]);
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ x: 0, y: 0 });
  });

  it("lays each vector tip-to-tail", () => {
    // (0.63, 0.83) then (0.5, 0.2) -> the second arrow starts where the first ended.
    const points = chainPoints([v(0.63, 0.83), v(0.5, 0.2)]);
    expect(points[1].x).toBeCloseTo(0.63, 6);
    expect(points[1].y).toBeCloseTo(0.83, 6);
    expect(points[2].x).toBeCloseTo(1.13, 6);
    expect(points[2].y).toBeCloseTo(1.03, 6);
  });

  it("is just the origin for a match with no answers yet", () => {
    expect(chainPoints([])).toEqual([{ x: 0, y: 0 }]);
  });
});

describe("chainEnd / reach", () => {
  it("ends at the summed vector", () => {
    expect(chainEnd([v(0.6, 0.4), v(0.3, 0.5)])).toEqual({
      x: expect.closeTo(0.9, 6),
      y: expect.closeTo(0.9, 6),
    });
  });

  it("measures how far the chain got toward the corner", () => {
    expect(reach({ x: 0.9, y: 0.9 })).toBeCloseTo(1.8, 6);
  });
});

describe("winnerOf", () => {
  it("picks the chain that reached nearest the top-right", () => {
    const strong = [v(0.8, 0.8), v(0.7, 0.9)];
    const weak = [v(0.2, 0.3), v(0.1, 0.2)];
    expect(winnerOf(strong, weak)).toBe("you");
    expect(winnerOf(weak, strong)).toBe("opponent");
  });

  it("calls an exact draw a tie", () => {
    expect(winnerOf([v(0.5, 0.5)], [v(0.5, 0.5)])).toBe("tie");
    // Trading strengths still ties when the total reach matches.
    expect(winnerOf([v(0.9, 0.1)], [v(0.1, 0.9)])).toBe("tie");
  });

  it("rewards total reach, not a single strong axis", () => {
    // Balanced 0.6/0.6 (reach 1.2) beats a lopsided 0.9/0.2 (reach 1.1).
    expect(winnerOf([v(0.6, 0.6)], [v(0.9, 0.2)])).toBe("you");
  });
});

describe("toSvgPoints", () => {
  it("flips y so the diagram grows upward from the origin corner", () => {
    const [origin] = toSvgPoints([{ x: 0, y: 0 }], 100, 10, 0, 100);
    expect(origin).toEqual({ x: 0, y: 100 }); // bottom-left in screen space

    const [corner] = toSvgPoints([{ x: 10, y: 10 }], 100, 10, 0, 100);
    expect(corner).toEqual({ x: 100, y: 0 }); // top-right
  });

  it("scales by the round count so a full match spans the square", () => {
    const [mid] = toSvgPoints([{ x: 5, y: 5 }], 100, 10, 0, 100);
    expect(mid).toEqual({ x: 50, y: 50 });
  });

  it("honours the plot origin offset", () => {
    const [p] = toSvgPoints([{ x: 0, y: 0 }], 100, 10, 44, 280);
    expect(p).toEqual({ x: 44, y: 280 });
  });
});

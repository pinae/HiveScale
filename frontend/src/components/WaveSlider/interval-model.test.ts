/**
 * WP-08 rework: the pure interval interaction model. This is where the tricky
 * usability rules are pinned down so the component wiring can stay thin.
 */
import { describe, expect, it } from "vitest";

import {
  dragEnd,
  effectiveBounds,
  moveCenter,
  setSymmetricHalf,
  symmetricHalf,
  type GuessValue,
} from "./interval-model";

const MIN = 0;
const MAX = 100;
const v = (center: number, widthLeft: number, widthRight: number): GuessValue => ({
  center,
  widthLeft,
  widthRight,
});
const noBorderEscapes = (g: GuessValue) => {
  const { lower, upper } = effectiveBounds(g, MIN, MAX);
  expect(lower).toBeGreaterThanOrEqual(MIN);
  expect(upper).toBeLessThanOrEqual(MAX);
  expect(lower).toBeLessThanOrEqual(g.center);
  expect(upper).toBeGreaterThanOrEqual(g.center);
};

describe("effectiveBounds", () => {
  it("clamps borders to the scale", () => {
    expect(effectiveBounds(v(0, 20, 20), MIN, MAX)).toEqual({ lower: 0, upper: 20 });
    expect(effectiveBounds(v(100, 20, 20), MIN, MAX)).toEqual({ lower: 80, upper: 100 });
  });
});

describe("moveCenter (drag the white dot)", () => {
  it("keeps the desired widths so the interval travels with the centre", () => {
    const moved = moveCenter(v(50, 12, 12), 70, MIN, MAX);
    expect(moved).toEqual(v(70, 12, 12));
    expect(effectiveBounds(moved, MIN, MAX)).toEqual({ lower: 58, upper: 82 });
  });

  it("squashes a side against a wall, then restores it on the way back", () => {
    const start = v(20, 20, 20);
    const atWall = moveCenter(start, 0, MIN, MAX);
    // Left half squashed to 0 at the wall; desired width is retained.
    expect(effectiveBounds(atWall, MIN, MAX)).toEqual({ lower: 0, upper: 20 });
    expect(atWall.widthLeft).toBe(20);
    // Coming back, the left side grows again up to its desired 20.
    expect(effectiveBounds(moveCenter(atWall, 10, MIN, MAX), MIN, MAX)).toEqual({ lower: 0, upper: 30 });
    expect(effectiveBounds(moveCenter(atWall, 25, MIN, MAX), MIN, MAX)).toEqual({ lower: 5, upper: 45 });
  });

  it("never lets the centre leave the scale", () => {
    noBorderEscapes(moveCenter(v(50, 10, 10), 999, MIN, MAX));
    noBorderEscapes(moveCenter(v(50, 10, 10), -999, MIN, MAX));
  });
});

describe("dragEnd (drag one interval end)", () => {
  it("moves only the dragged border, leaving the centre put", () => {
    const r = dragEnd(v(50, 10, 10), "upper", 55, MIN, MAX);
    expect(r).toEqual(v(50, 10, 5));
    expect(effectiveBounds(r, MIN, MAX)).toEqual({ lower: 40, upper: 55 });
  });

  it("pushes the centre only when the end would cross it", () => {
    const r = dragEnd(v(50, 10, 10), "upper", 45, MIN, MAX);
    expect(r.center).toBe(45); // centre pushed down to stay inside
    expect(effectiveBounds(r, MIN, MAX)).toEqual({ lower: 40, upper: 45 });
  });

  it("collapses to a point rather than inverting", () => {
    const r = dragEnd(v(50, 10, 10), "upper", 20, MIN, MAX); // dragged below the lower border (40)
    expect(effectiveBounds(r, MIN, MAX)).toEqual({ lower: 40, upper: 40 });
    expect(r.center).toBe(40);
  });

  it("works symmetrically for the lower end", () => {
    const r = dragEnd(v(50, 10, 10), "lower", 45, MIN, MAX);
    expect(effectiveBounds(r, MIN, MAX)).toEqual({ lower: 45, upper: 60 });
    expect(r.center).toBe(50);
  });

  it("keeps borders inside the scale", () => {
    noBorderEscapes(dragEnd(v(90, 5, 5), "upper", 500, MIN, MAX));
    noBorderEscapes(dragEnd(v(10, 5, 5), "lower", -500, MIN, MAX));
  });
});

describe("symmetric resize (wheel / vertical drag)", () => {
  it("centres the interval and sets both half-widths", () => {
    expect(setSymmetricHalf(v(50, 5, 20), 15, MIN, MAX)).toEqual(v(50, 15, 15));
  });

  it("cannot push a border past a nearby wall", () => {
    // centre at 90 -> max symmetric half is 10.
    expect(setSymmetricHalf(v(90, 0, 0), 40, MIN, MAX)).toEqual(v(90, 10, 10));
    noBorderEscapes(setSymmetricHalf(v(90, 0, 0), 40, MIN, MAX));
  });

  it("reports the current symmetric half-width, bounded by the scale", () => {
    expect(symmetricHalf(v(50, 10, 20), MIN, MAX)).toBe(15);
    expect(symmetricHalf(v(95, 20, 20), MIN, MAX)).toBe(5); // bounded by the wall
  });
});

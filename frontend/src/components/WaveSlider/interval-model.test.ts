/**
 * The pure interaction model. This is where the tricky usability rules are
 * pinned down so the component wiring can stay thin.
 */
import { describe, expect, it } from "vitest";

import {
  effectiveBounds,
  handlePlacement,
  moveCenter,
  resizeSpread,
  setSigma,
  setSpread,
  sigmaCap,
  type GuessValue,
} from "./interval-model";

const MIN = 0;
const MAX = 100;
const v = (center: number, widthLeft: number, widthRight: number): GuessValue => ({
  center,
  widthLeft,
  widthRight,
});

describe("effectiveBounds", () => {
  it("clamps the display interval to the scale (σ itself is not capped)", () => {
    expect(effectiveBounds(v(0, 20, 20), MIN, MAX)).toEqual({ lower: 0, upper: 20 });
    expect(effectiveBounds(v(100, 20, 20), MIN, MAX)).toEqual({ lower: 80, upper: 100 });
    // A σ wider than the wall still shows a clamped interval.
    expect(effectiveBounds(v(95, 5, 40), MIN, MAX)).toEqual({ lower: 90, upper: 100 });
  });
});

describe("moveCenter (drag the white dot)", () => {
  it("keeps the widths so the bell travels with the centre", () => {
    const moved = moveCenter(v(50, 12, 12), 70, MIN, MAX);
    expect(moved).toEqual(v(70, 12, 12));
    expect(effectiveBounds(moved, MIN, MAX)).toEqual({ lower: 58, upper: 82 });
  });

  it("never lets the centre leave the scale", () => {
    expect(moveCenter(v(50, 10, 10), 999, MIN, MAX).center).toBe(100);
    expect(moveCenter(v(50, 10, 10), -999, MIN, MAX).center).toBe(0);
  });
});

describe("spread resize (wheel / centre vertical drag)", () => {
  it("grows both half-widths when the delta is positive, shrinks when negative", () => {
    expect(resizeSpread(v(50, 10, 10), 5, MIN, MAX)).toEqual(v(50, 15, 15));
    expect(resizeSpread(v(50, 10, 10), -4, MIN, MAX)).toEqual(v(50, 6, 6));
  });

  it("never lets a half-width go negative", () => {
    expect(resizeSpread(v(50, 2, 2), -10, MIN, MAX)).toEqual(v(50, 0, 0));
  });

  it("lets σ grow past the wall up to the cap (the wall no longer stops it)", () => {
    // Centre at 20: both sides keep growing well beyond their walls, capped at 100.
    expect(resizeSpread(v(20, 15, 15), 40, MIN, MAX)).toEqual(v(20, 55, 55));
    expect(resizeSpread(v(50, 90, 90), 50, MIN, MAX)).toEqual(v(50, 100, 100)); // cap
  });

  it("setSpread targets each side absolutely, capped at sigmaCap", () => {
    expect(setSpread(v(50, 5, 20), 15, 15, MIN, MAX)).toEqual(v(50, 15, 15));
    expect(setSpread(v(90, 0, 0), 40, 40, MIN, MAX)).toEqual(v(90, 40, 40)); // past the wall, fine
    expect(setSpread(v(50, 0, 0), 999, 999, MIN, MAX)).toEqual(v(50, 100, 100));
  });
});

describe("setSigma (one σ handle)", () => {
  it("sets a single side's σ, capped at sigmaCap", () => {
    expect(setSigma(v(50, 10, 10), "lower", 30, MIN, MAX)).toEqual(v(50, 30, 10));
    expect(setSigma(v(50, 10, 10), "upper", 30, MIN, MAX)).toEqual(v(50, 10, 30));
    expect(setSigma(v(50, 10, 10), "upper", 500, MIN, MAX)).toEqual(v(50, 10, 100));
    expect(setSigma(v(50, 10, 10), "lower", -5, MIN, MAX)).toEqual(v(50, 0, 10));
  });
});

describe("sigmaCap", () => {
  it("is the scale span", () => {
    expect(sigmaCap(0, 100)).toBe(100);
    expect(sigmaCap(10, 60)).toBe(50);
  });
});

describe("handlePlacement (where a σ handle sits)", () => {
  it("rides the scale at centre ∓ σ while σ fits", () => {
    expect(handlePlacement("lower", 50, 10, MIN, MAX)).toEqual({ frac: 0.4, drop: 0, offScale: false });
    expect(handlePlacement("upper", 50, 10, MIN, MAX)).toEqual({ frac: 0.6, drop: 0, offScale: false });
  });

  it("pins at the wall and drops as σ passes it", () => {
    // Centre 95, right wall = 5. σ = 5 sits exactly at the wall (no drop yet).
    expect(handlePlacement("upper", 95, 5, MIN, MAX)).toEqual({ frac: 1, drop: 0, offScale: false });
    // σ well past the wall -> pinned at frac 1, dropped a fraction of the way down.
    const past = handlePlacement("upper", 95, 52.5, MIN, MAX);
    expect(past.frac).toBe(1);
    expect(past.offScale).toBe(true);
    expect(past.drop).toBeCloseTo(0.5, 5); // (52.5 - 5) / (100 - 5) = 0.5
    // At σ = cap it has dropped all the way.
    expect(handlePlacement("upper", 95, 100, MIN, MAX).drop).toBe(1);
  });

  it("mirrors to the min wall for the lower handle", () => {
    const past = handlePlacement("lower", 5, 52.5, MIN, MAX);
    expect(past.frac).toBe(0);
    expect(past.offScale).toBe(true);
    expect(past.drop).toBeCloseTo(0.5, 5);
  });
});

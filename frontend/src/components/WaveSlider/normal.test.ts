import { describe, expect, it } from "vitest";

import { bellDensity, bellGeometry, MIN_SIGMA, splitNormalMasses } from "./normal";

describe("bellDensity (split normal)", () => {
  it("peaks at the centre", () => {
    expect(bellDensity(50, 50, 10, 10)).toBe(1);
    expect(bellDensity(40, 50, 10, 10)).toBeLessThan(1);
    expect(bellDensity(60, 50, 10, 10)).toBeLessThan(1);
  });

  it("is asymmetric when the widths differ", () => {
    // A wide right side falls off more slowly than a narrow left side.
    const left = bellDensity(40, 50, 5, 30); // 10 below, narrow sigma
    const right = bellDensity(60, 50, 5, 30); // 10 above, wide sigma
    expect(right).toBeGreaterThan(left);
  });

  it("floors sigma so a zero-width guess is a finite spike, not a divide-by-zero", () => {
    const d = bellDensity(50 + MIN_SIGMA, 50, 0, 0);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeCloseTo(Math.exp(-0.5), 6); // exactly one floored-sigma away
  });
});

describe("splitNormalMasses (matches the backend split_normal_histogram)", () => {
  it("returns `buckets` masses that sum to 1", () => {
    const m = splitNormalMasses(50, 12, 12, 20);
    expect(m).toHaveLength(20);
    expect(m.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(Math.min(...m)).toBeGreaterThanOrEqual(0);
  });

  it("peaks in the bucket containing the centre and is symmetric for equal widths", () => {
    const m = splitNormalMasses(50, 12, 12, 20); // centre 50 straddles buckets 9 & 10
    const peak = Math.max(...m);
    expect(m[9]).toBeCloseTo(peak, 6);
    expect(m[10]).toBeCloseTo(peak, 6);
    expect(m[9]).toBeCloseTo(m[10], 6); // symmetric
  });

  it("leans on the wall when the guess is pushed to an extreme (mass folds inward)", () => {
    const m = splitNormalMasses(2, 10, 10, 20);
    expect(m[0]).toBe(Math.max(...m)); // heaviest bucket is against the low wall
    expect(m.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe("bellGeometry", () => {
  it("returns a closed area path and an open outline path", () => {
    const g = bellGeometry({ center: 50, widthLeft: 12, widthRight: 12 }, 0, 100, 1000, 260);
    expect(g.area.startsWith("M")).toBe(true);
    expect(g.area.endsWith("Z")).toBe(true); // filled polygon
    expect(g.line.startsWith("M")).toBe(true);
    expect(g.line.includes("Z")).toBe(false); // open curve for the stroke
    expect(g.peakX).toBeCloseTo(500, 0); // centre 50 -> middle of a 1000-wide viewBox
  });

  it("maps the peak to the right side under rtl", () => {
    const g = bellGeometry({ center: 30, widthLeft: 10, widthRight: 10 }, 0, 100, 1000, 260, "rtl");
    expect(g.peakX).toBeCloseTo(700, 0);
  });
});

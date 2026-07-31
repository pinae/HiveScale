import { describe, expect, it } from "vitest";

import { histogramCurve } from "./curves";

describe("histogramCurve", () => {
  it("returns an open line and a baseline-closed area on a shared scale", () => {
    const hist = [0, 0.1, 0.4, 0.3, 0.2];
    const { line, area } = histogramCurve(hist, 1000, 100, Math.max(...hist));
    expect(line.startsWith("M")).toBe(true);
    expect(line.includes("Z")).toBe(false); // open stroke
    expect(area.startsWith("M 0,100")).toBe(true); // starts on the baseline
    expect(area.endsWith("Z")).toBe(true); // closed fill
  });

  it("puts the tallest bucket at the top and an empty bucket at the baseline", () => {
    // Peak in bucket 1 -> y≈0; empty bucket 0 -> y=height.
    const { line } = histogramCurve([0, 1], 100, 100, 1);
    // First point (bucket 0 centre) sits on the baseline (y=100).
    expect(line).toContain("25.00,100.00");
    // Second point (bucket 1 centre) reaches the top (y=0).
    expect(line).toContain("75.00,0.00");
  });
});

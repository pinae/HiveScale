import { describe, expect, it } from "vitest";

import { MISS_TEMPLATES, composeMissReason } from "./missReason";

const base = { meansMatch: 0.53, beliefMatch: 0.12, threshold: 0.7 };

/** Deterministically pick template `i`. */
const pick = (i: number) => () => (i + 0.5) / MISS_TEMPLATES.length;

describe("composeMissReason", () => {
  it("ships 50 varied templates", () => {
    expect(MISS_TEMPLATES).toHaveLength(50);
    expect(new Set(MISS_TEMPLATES).size).toBe(50); // no duplicates
  });

  it("every template names the threshold and at least one real number", () => {
    for (const t of MISS_TEMPLATES) {
      expect(t, t).toContain("{threshold}");
      expect(t, t).toMatch(/\{(bestPct|worstPct|means|belief)\}/);
      expect(t, t).toMatch(/\{Loss\}|\{loss\}/); // always says what was lost
    }
  });

  it("fills every template with no leftover placeholders, for each loss combo", () => {
    const combos = [
      { streakLost: true, multiplierLost: true },
      { streakLost: true, multiplierLost: false },
      { streakLost: false, multiplierLost: true },
    ];
    MISS_TEMPLATES.forEach((_, i) => {
      for (const c of combos) {
        const msg = composeMissReason({ ...base, ...c }, pick(i));
        expect(msg, `template ${i}`).not.toMatch(/[{}]/);
        expect(msg.length).toBeGreaterThan(10);
      }
    });
  });

  it("fills in the player's actual numbers and the threshold", () => {
    // Template 0: "{Loss} reset — your best was {best} at {bestPct}%, under the {threshold}% you need."
    const msg = composeMissReason({ ...base, streakLost: true, multiplierLost: true }, pick(0));
    expect(msg).toContain("means match at 53%"); // 53 > 12, so means is best
    expect(msg).toContain("70%"); // the threshold
    expect(msg).toMatch(/streak and multiplier/i);
  });

  it("names the stronger side as 'best'", () => {
    const msg = composeMissReason(
      { meansMatch: 0.12, beliefMatch: 0.43, threshold: 0.7, streakLost: true, multiplierLost: false },
      pick(0),
    );
    expect(msg).toContain("belief match at 43%");
    expect(msg).toMatch(/your streak/i);
    expect(msg).not.toMatch(/multiplier/i);
  });

  it("varies with the RNG (not the same message every time)", () => {
    const facts = { ...base, streakLost: true, multiplierLost: true };
    const a = composeMissReason(facts, pick(3));
    const b = composeMissReason(facts, pick(17));
    expect(a).not.toBe(b);
  });
});

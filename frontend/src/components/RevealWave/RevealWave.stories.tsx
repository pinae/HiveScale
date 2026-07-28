import type { Meta, StoryObj } from "@storybook/react";

import RevealWave from "./RevealWave";
import type { HumanReveal, PioneerReveal } from "../../api/reveal";

/**
 * Storybook `beforeEach`: report `prefers-reduced-motion: no-preference` while a
 * story is on screen so the reveal animation is previewable even when the
 * viewer's OS/browser asserts "reduce" (e.g. GNOME `enable-animations` off).
 * The real app still honours the setting via RevealWave's own detection.
 */
function forceMotion() {
  const original = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) =>
    /prefers-reduced-motion/.test(query)
      ? ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent: () => false,
        } as MediaQueryList)
      : original(query)) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

/** Build a normalized 20-bucket histogram peaked at the given buckets. */
function hist(...peaks: number[]): number[] {
  const raw = Array.from({ length: 20 }, (_, i) =>
    peaks.reduce((sum, p) => sum + Math.exp(-((i - p) ** 2) / 6), 0),
  );
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => x / total);
}

function human(overrides: Partial<HumanReveal> = {}): HumanReveal {
  return {
    source: "human",
    counted: true,
    score: { total: 812, distance_points: 560, calibration_points: 252, covered_fraction: 0.68 },
    crowd: { histogram: hist(10), median: 52, q25: 44, q75: 60, n: 41 },
    percentile: 78,
    bimodal: false,
    streak: { hot: 3 },
    player: { xp: 4212, level: 2 },
    ...overrides,
  };
}

const meta = {
  title: "Round/RevealWave",
  component: RevealWave,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 420, margin: "1rem auto" }}>
        <Story />
      </div>
    ),
  ],
  args: { guess: { center: 52, widthLeft: 10, widthRight: 10 }, animate: false },
} satisfies Meta<typeof RevealWave>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Nailed: Story = {
  args: { reveal: human(), guess: { center: 52, widthLeft: 9, widthRight: 9 } },
};

export const ConfidentlyWrong: Story = {
  args: {
    reveal: human({
      score: { total: 214, distance_points: 90, calibration_points: 124, covered_fraction: 0.3 },
      percentile: 21,
    }),
    guess: { center: 82, widthLeft: 5, widthRight: 5 },
    quipSeed: 1,
  },
};

export const CowardlyWide: Story = {
  args: {
    reveal: human({ percentile: 55 }),
    guess: { center: 50, widthLeft: 30, widthRight: 30 },
  },
};

export const Contrarian: Story = {
  args: {
    reveal: human({ percentile: 12 }),
    guess: { center: 84, widthLeft: 18, widthRight: 18 },
  },
};

export const BimodalDrama: Story = {
  args: {
    reveal: human({ bimodal: true, crowd: { histogram: hist(4, 15), median: 50, q25: 22, q75: 76, n: 63 } }),
    guess: { center: 30, widthLeft: 12, widthRight: 12 },
  },
};

export const BeatTheBot: Story = {
  args: {
    reveal: human(),
    guess: { center: 52, widthLeft: 9, widthRight: 9 },
    aiEstimate: { provisional: false, median: 70, q25: 62, q75: 80, histogram: hist(14) },
  },
};

export const TooFastToCount: Story = {
  args: { reveal: human({ counted: false }) },
};

export const AnimatedRise: Story = {
  args: { reveal: human(), animate: true },
  // Force motion on so the rise/count-up is visible regardless of the viewer's
  // reduced-motion setting. Reload the story to replay it.
  beforeEach: forceMotion,
};

const pioneer: PioneerReveal = {
  source: "pioneer",
  counted: true,
  pioneer_bonus: 550,
  ai_estimate: null,
  streak: { hot: 0 },
  player: { xp: 550, level: 1 },
};

export const Pioneer: Story = {
  args: { reveal: pioneer, guess: { center: 40, widthLeft: 10, widthRight: 10 } },
};

export const PioneerWithAiEstimate: Story = {
  args: {
    reveal: {
      ...pioneer,
      ai_estimate: { provisional: true, median: 62, q25: 50, q75: 74, histogram: hist(12) },
    },
    guess: { center: 40, widthLeft: 10, widthRight: 10 },
  },
};

import type { Meta, StoryObj } from "@storybook/react";

import DailyWaveResult from "./DailyWaveResult";

const meta = {
  title: "Meta/DailyWaveResult",
  component: DailyWaveResult,
  tags: ["autodocs"],
  args: {
    date: "2026-07-28",
    results: ["🎯", "🌊", "🌊", "🌫️", "🎯", "🌊", "🥶", "🌊", "🎯", "🌊"],
    score: 6120,
    dailyStreak: 4,
    shareString: "HiveScale 2026-07-28\n🎯🌊🌊🌫️🎯🌊🥶🌊🎯🌊\n6120 pts · 🔥4",
    onDone: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 420, margin: "1rem auto" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DailyWaveResult>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const PerfectRun: Story = {
  args: {
    results: Array<string>(10).fill("🎯"),
    score: 9500,
    dailyStreak: 12,
    shareString: "HiveScale 2026-07-28\n🎯🎯🎯🎯🎯🎯🎯🎯🎯🎯\n9500 pts · 🔥12",
  },
};

export const RoughDay: Story = {
  args: {
    results: ["🥶", "🌫️", "🥶", "🌫️", "🥶", "🥶", "🌫️", "🥶", "🌫️", "🥶"],
    score: 1450,
    dailyStreak: 0,
    shareString: "HiveScale 2026-07-28\n🥶🌫️🥶🌫️🥶🥶🌫️🥶🌫️🥶\n1450 pts",
  },
};

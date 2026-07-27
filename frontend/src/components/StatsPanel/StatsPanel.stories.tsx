import type { Meta, StoryObj } from "@storybook/react";

import StatsPanel from "./StatsPanel";

const meta = {
  title: "Loop/StatsPanel",
  component: StatsPanel,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 420, margin: "1rem auto" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    stats: {
      archetype: { name: "Oracle", blurb: "Tight and right — the crowd whisperer." },
      calibration: { n: 42, hit_rate: 0.66, mean_width: 21 },
      streaks: { hot: 3, daily: 7, freezes: 2 },
      xp: 8410,
      level: 6,
    },
  },
} satisfies Meta<typeof StatsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Oracle: Story = {};

export const Diplomat: Story = {
  args: {
    stats: {
      archetype: { name: "Diplomat", blurb: "Wide and safe — you hedge to stay covered." },
      calibration: { n: 30, hit_rate: 0.9, mean_width: 55 },
      streaks: { hot: 0, daily: 2, freezes: 0 },
      xp: 5100,
      level: 5,
    },
  },
};

export const Newcomer: Story = {
  args: {
    stats: {
      archetype: { name: "Newcomer", blurb: "Play a few rounds and your archetype will emerge." },
      calibration: { n: 0, hit_rate: 0, mean_width: 0 },
      streaks: { hot: 0, daily: 1, freezes: 0 },
      xp: 120,
      level: 1,
    },
  },
};

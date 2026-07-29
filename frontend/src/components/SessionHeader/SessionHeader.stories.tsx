import type { Meta, StoryObj } from "@storybook/react";

import SessionHeader from "./SessionHeader";

const meta = {
  title: "Loop/SessionHeader",
  component: SessionHeader,
  tags: ["autodocs"],
  args: { xp: 4212, level: 3, streak: 0 },
} satisfies Meta<typeof SessionHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const HotStreak: Story = { args: { streak: 5 } };

export const FreshPlayer: Story = { args: { xp: 0, level: 1, streak: 0 } };

export const WithActions: Story = {
  args: {
    onShowStats: () => {},
    onDailyWave: () => {},
    onVote: () => {},
    onChallenge: () => {},
    onScaleRequest: () => {},
    onClaim: () => {},
    isClaimed: false,
  },
};

export const Claimed: Story = {
  args: { onShowStats: () => {}, onDailyWave: () => {}, onClaim: () => {}, isClaimed: true },
};

export const LoadedMultiplier: Story = {
  args: {
    xp: 5_000,
    level: 3,
    streak: 4,
    multiplier: 7,
    progress: { level: 3, xp: 5_000, into_level: 3_500, level_span: 7_000, next_level_xp: 8_000 },
    onShowStats: () => {},
    onDailyWave: () => {},
    onClaim: () => {},
  },
};

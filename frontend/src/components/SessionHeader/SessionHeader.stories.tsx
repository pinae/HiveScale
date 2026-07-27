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

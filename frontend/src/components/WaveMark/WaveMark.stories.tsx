import type { Meta, StoryObj } from "@storybook/react";

import WaveMark from "./WaveMark";

const meta = {
  title: "Brand/WaveMark",
  component: WaveMark,
  tags: ["autodocs"],
} satisfies Meta<typeof WaveMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Large: Story = { args: { size: 160 } };

export const ReducedMotion: Story = { args: { animated: false } };

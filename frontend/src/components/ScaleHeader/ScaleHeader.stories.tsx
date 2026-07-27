import type { Meta, StoryObj } from "@storybook/react";

import ScaleHeader from "./ScaleHeader";

const meta = {
  title: "Round/ScaleHeader",
  component: ScaleHeader,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 360, margin: "2rem auto" }}>
        <Story />
      </div>
    ),
  ],
  args: { left: "sophisticated", right: "overly complicated" },
} satisfies Meta<typeof ScaleHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ShortLabels: Story = { args: { left: "cheap", right: "expensive" } };

export const LongLabels: Story = {
  args: { left: "a deeply comforting ritual", right: "an exhausting obligation" },
};

export const RightToLeft: Story = {
  args: { dir: "rtl", left: "رخيص", right: "غالي" },
};

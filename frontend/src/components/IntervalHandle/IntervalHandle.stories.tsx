import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import IntervalHandle, { type IntervalHandleProps } from "./IntervalHandle";

/** The handle is absolutely positioned; give it a track to sit on. */
function Track(args: IntervalHandleProps) {
  return (
    <div
      className="bsg-slider-track"
      style={{ position: "relative", width: 320, margin: "2rem auto" }}
    >
      <div className="bsg-slider-rail" aria-hidden="true" />
      <IntervalHandle {...args} />
    </div>
  );
}

const meta = {
  title: "Round/IntervalHandle",
  component: IntervalHandle,
  tags: ["autodocs"],
  args: { label: "Left spread", sigma: 22, sigmaMax: 100, leftFraction: 0.35, onNudge: fn() },
  render: (args) => <Track {...args} />,
} satisfies Meta<typeof IntervalHandle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OffScale: Story = {
  args: { label: "Right spread", sigma: 65, leftFraction: 1, drop: 0.6, offScale: true },
};

export const Disabled: Story = { args: { disabled: true } };

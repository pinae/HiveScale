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
  args: { label: "Interval lower bound", position: 40, onNudge: fn() },
  render: (args) => <Track {...args} />,
} satisfies Meta<typeof IntervalHandle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NearPole: Story = { args: { position: 4 } };

export const Disabled: Story = { args: { disabled: true } };

export const RightToLeft: Story = { args: { dir: "rtl", position: 30 } };

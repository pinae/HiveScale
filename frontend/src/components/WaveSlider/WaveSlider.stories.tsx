import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "@storybook/test";
import { useState } from "react";

import WaveSlider, { type GuessValue, type WaveSliderProps } from "./WaveSlider";

/** Stateful wrapper so the controlled slider is interactive in every story. */
function Demo(args: WaveSliderProps) {
  const [value, setValue] = useState<GuessValue>(args.value);
  return (
    <div style={{ maxWidth: 360, margin: "2rem auto" }}>
      <WaveSlider {...args} value={value} onChange={setValue} />
    </div>
  );
}

const meta = {
  title: "Round/WaveSlider",
  component: WaveSlider,
  tags: ["autodocs"],
  args: {
    value: { center: 50, widthLeft: 12, widthRight: 12 },
    onChange: fn(),
  },
  render: (args) => <Demo {...args} />,
} satisfies Meta<typeof WaveSlider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const NarrowInterval: Story = {
  args: { value: { center: 62, widthLeft: 4, widthRight: 4 } },
};

export const WideInterval: Story = {
  args: { value: { center: 45, widthLeft: 26, widthRight: 26 } },
};

export const Asymmetric: Story = {
  args: { value: { center: 40, widthLeft: 6, widthRight: 24 } },
};

export const AtTheLeftPole: Story = {
  args: { value: { center: 0, widthLeft: 0, widthRight: 14 } },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const RightToLeft: Story = {
  args: { dir: "rtl", value: { center: 35, widthLeft: 10, widthRight: 18 } },
};

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
};

/** Interaction test (a11y): keyboard fully drives the guess. */
export const KeyboardControl: Story = {
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const thumb = canvas.getByRole("slider", { name: /your guess/i });

    await step("Arrow keys move the centre", async () => {
      thumb.focus();
      await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
      await expect(thumb).toHaveAttribute("aria-valuenow", "55");
    });

    await step("Shift+Arrow grows both σ", async () => {
      await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
      await expect(canvas.getByRole("slider", { name: /right spread/i })).toHaveAttribute(
        "aria-valuenow",
        "13",
      );
      await expect(canvas.getByRole("slider", { name: /left spread/i })).toHaveAttribute(
        "aria-valuenow",
        "13",
      );
    });
  },
};

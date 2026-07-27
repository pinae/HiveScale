import type { Meta, StoryObj } from "@storybook/react";

import ThingCard from "./ThingCard";

const meta = {
  title: "Round/ThingCard",
  component: ThingCard,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 360, margin: "2rem auto" }}>
        <Story />
      </div>
    ),
  ],
  args: { text: "Robotic lawnmower" },
} satisfies Meta<typeof ThingCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHint: Story = {
  args: { text: "Pineapple on pizza", hint: "Place it on disgusting ↔ delightful" },
};

export const LongText: Story = {
  args: { text: "A group chat that has been silent for three years" },
};

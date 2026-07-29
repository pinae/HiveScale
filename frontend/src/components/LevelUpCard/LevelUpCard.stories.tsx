import type { Meta, StoryObj } from "@storybook/react";

import LevelUpCard from "./LevelUpCard";

const meta = {
  title: "Meta/LevelUpCard",
  component: LevelUpCard,
  parameters: { layout: "fullscreen" },
  args: { onDismiss: () => {} },
} satisfies Meta<typeof LevelUpCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Level2: Story = { args: { level: 2 } };
export const Level5: Story = { args: { level: 5 } };
export const Level10: Story = { args: { level: 10 } };
export const Level15: Story = { args: { level: 15 } };

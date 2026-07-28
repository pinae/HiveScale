import type { Meta, StoryObj } from "@storybook/react";

import ClaimPanel from "./ClaimPanel";

/** Resolve after a short delay so the busy states are visible in the story. */
function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 300));
}

const meta = {
  title: "Meta/ClaimPanel",
  component: ClaimPanel,
  tags: ["autodocs"],
  args: { onClaimed: () => {}, onCancel: () => {} },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 420, margin: "1rem auto" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ClaimPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Dev "echo" delivery: the confirm link comes back inline so you can finish here. */
export const Default: Story = {
  args: {
    requestClaim: () => delay({ detail: "Claim link issued.", claim_token: "dev-token" }),
    confirmClaim: () => delay({ player: { level: 3, xp: 1500, is_claimed: true }, merged: false }),
  },
};

export const MergesExistingAccount: Story = {
  args: {
    requestClaim: () => delay({ detail: "Claim link issued.", claim_token: "dev-token" }),
    confirmClaim: () => delay({ player: { level: 7, xp: 9001, is_claimed: true }, merged: true }),
  },
};

/** Production delivery emails the link — no inline confirm affordance. */
export const EmailedDelivery: Story = {
  args: {
    requestClaim: () => delay({ detail: "Claim link issued." }),
  },
};

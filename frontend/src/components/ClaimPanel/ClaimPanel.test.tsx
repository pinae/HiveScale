import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ClaimPanel from "./ClaimPanel";
import { ApiError } from "../../api/client";

const profile = { level: 3, xp: 1500, is_claimed: true };
const sendLink = () => screen.getByRole("button", { name: /magic link/i });

describe("ClaimPanel", () => {
  it("requests a link, confirms via the dev token, and reports the profile", async () => {
    const requestClaim = vi.fn().mockResolvedValue({ detail: "ok", claim_token: "tok-123" });
    const confirmClaim = vi.fn().mockResolvedValue({ player: profile, merged: false });
    const onClaimed = vi.fn();
    const user = userEvent.setup();
    render(
      <ClaimPanel onClaimed={onClaimed} requestClaim={requestClaim} confirmClaim={confirmClaim} />,
    );

    await user.type(screen.getByLabelText(/email/i), "player@example.com");
    await user.click(sendLink());

    expect(requestClaim).toHaveBeenCalledWith("player@example.com");
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /confirm now/i }));
    expect(confirmClaim).toHaveBeenCalledWith("tok-123");
    expect(onClaimed).toHaveBeenCalledWith({ player: profile, merged: false });
    expect(await screen.findByText(/progress is now tied to your email/i)).toBeInTheDocument();
  });

  it("celebrates a merge when the email already had an account", async () => {
    const user = userEvent.setup();
    render(
      <ClaimPanel
        onClaimed={() => {}}
        requestClaim={vi.fn().mockResolvedValue({ detail: "ok", claim_token: "t" })}
        confirmClaim={vi.fn().mockResolvedValue({ player: profile, merged: true })}
      />,
    );
    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.click(sendLink());
    await user.click(await screen.findByRole("button", { name: /confirm now/i }));
    expect(await screen.findByText(/accounts are merged/i)).toBeInTheDocument();
  });

  it("shows an error and lets the player retry when the link is invalid", async () => {
    const confirmClaim = vi.fn().mockRejectedValue(new ApiError(400, "Invalid or expired claim link."));
    const user = userEvent.setup();
    render(
      <ClaimPanel
        onClaimed={() => {}}
        requestClaim={vi.fn().mockResolvedValue({ detail: "ok", claim_token: "bad" })}
        confirmClaim={confirmClaim}
      />,
    );
    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.click(sendLink());
    await user.click(await screen.findByRole("button", { name: /confirm now/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid or expired/i);
    expect(screen.getByRole("button", { name: /confirm now/i })).toBeInTheDocument();
  });

  it("without a dev token, only tells the player to check their email", async () => {
    const user = userEvent.setup();
    render(
      <ClaimPanel onClaimed={() => {}} requestClaim={vi.fn().mockResolvedValue({ detail: "ok" })} />,
    );
    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.click(sendLink());
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm now/i })).not.toBeInTheDocument();
  });
});

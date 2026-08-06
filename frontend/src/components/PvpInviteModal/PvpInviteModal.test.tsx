/**
 * Starting a battle: the privacy-friendly link option is always there; the email
 * option only appears for a player who saved their own account, and it carries
 * the anti-bot round.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import PvpInviteModal from "./PvpInviteModal";
import { ApiError } from "../../api/client";

const captcha = {
  captcha_token: "cap-tok",
  thing: { text: "Robotic lawnmower" },
  scale: { left: "sophisticated", right: "overly complicated" },
};

const started = { join_code: "abc123", link: "https://play.example/?pvp=abc123", invited: false };

describe("PvpInviteModal", () => {
  it("always offers the link option and explains it shares no address", () => {
    render(
      <PvpInviteModal
        isClaimed={false}
        onStarted={vi.fn()}
        fetchCaptcha={vi.fn()}
        startMatch={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /create a battle link/i })).toBeInTheDocument();
    expect(screen.getByText(/nobody.s email address is shared/i)).toBeInTheDocument();
  });

  it("hides the email form until the player has saved their own account", () => {
    const fetchCaptcha = vi.fn();
    render(
      <PvpInviteModal
        isClaimed={false}
        onStarted={vi.fn()}
        fetchCaptcha={fetchCaptcha}
        startMatch={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/friend.s email/i)).not.toBeInTheDocument();
    expect(screen.getByText(/save your own progress with an email first/i)).toBeInTheDocument();
    expect(fetchCaptcha).not.toHaveBeenCalled(); // no captcha needed for the link path
  });

  it("creates a link and shows it for copying", async () => {
    const startMatch = vi.fn().mockResolvedValue(started);
    const user = userEvent.setup();
    render(
      <PvpInviteModal
        isClaimed={false}
        onStarted={vi.fn()}
        fetchCaptcha={vi.fn()}
        startMatch={startMatch}
      />,
    );

    await user.click(screen.getByRole("button", { name: /create a battle link/i }));

    const field = await screen.findByLabelText(/battle link/i);
    expect(field).toHaveValue(started.link);
    expect(startMatch).toHaveBeenCalledWith({ mode: "link" });
  });

  it("offers the email form with an anti-bot round once the account is saved", async () => {
    const fetchCaptcha = vi.fn().mockResolvedValue(captcha);
    render(
      <PvpInviteModal
        isClaimed
        onStarted={vi.fn()}
        fetchCaptcha={fetchCaptcha}
        startMatch={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Robotic lawnmower" })).toBeInTheDocument();
    expect(screen.getByLabelText(/friend.s email/i)).toBeInTheDocument();
    expect(screen.getByText(/so we know you.re human/i)).toBeInTheDocument();
  });

  it("sends the invite with the captcha answer and enters the match", async () => {
    const fetchCaptcha = vi.fn().mockResolvedValue(captcha);
    const startMatch = vi.fn().mockResolvedValue({ ...started, invited: true });
    const onStarted = vi.fn();
    const user = userEvent.setup();
    render(
      <PvpInviteModal
        isClaimed
        onStarted={onStarted}
        fetchCaptcha={fetchCaptcha}
        startMatch={startMatch}
      />,
    );

    await screen.findByRole("heading", { name: "Robotic lawnmower" });
    await user.type(screen.getByLabelText(/friend.s email/i), "friend@example.com");
    await user.click(screen.getByRole("button", { name: /send the challenge/i }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("abc123"));
    const payload = startMatch.mock.calls[0][0];
    expect(payload.mode).toBe("email");
    expect(payload.email).toBe("friend@example.com");
    expect(payload.captcha_token).toBe("cap-tok");
    expect(payload).toHaveProperty("center"); // the captcha guess rides along
    expect(payload).toHaveProperty("pointer_path");
  });

  it("surfaces a rejected invite and deals a fresh check to retry with", async () => {
    const fetchCaptcha = vi.fn().mockResolvedValue(captcha);
    // The real client throws ApiError, whose message is the backend's reason.
    const startMatch = vi.fn().mockRejectedValue(new ApiError(400, "That was too quick."));
    const user = userEvent.setup();
    render(
      <PvpInviteModal
        isClaimed
        onStarted={vi.fn()}
        fetchCaptcha={fetchCaptcha}
        startMatch={startMatch}
      />,
    );

    await screen.findByRole("heading", { name: "Robotic lawnmower" });
    await user.type(screen.getByLabelText(/friend.s email/i), "friend@example.com");
    await user.click(screen.getByRole("button", { name: /send the challenge/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/too quick/i);
    await waitFor(() => expect(fetchCaptcha).toHaveBeenCalledTimes(2)); // a fresh round
  });
});

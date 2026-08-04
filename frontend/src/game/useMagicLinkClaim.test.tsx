/**
 * The magic-link claim hook: it confirms a `?claim=<token>` link once on load,
 * surfaces a notice, strips the token from the URL, and — the fix here — clears
 * the notice after a few seconds so it doesn't linger over the game.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CLAIM_NOTICE_MS, useMagicLinkClaim } from "./useMagicLinkClaim";
import * as client from "../api/client";

function Harness({ onConfirmed = () => {} }: { onConfirmed?: () => void }) {
  const notice = useMagicLinkClaim(() => onConfirmed());
  return <div data-testid="notice">{notice ?? ""}</div>;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("useMagicLinkClaim", () => {
  it("does nothing without a ?claim token", () => {
    window.history.replaceState(null, "", "/");
    render(<Harness />);
    expect(screen.getByTestId("notice").textContent).toBe("");
  });

  it("confirms the token, surfaces a notice, strips the token, then auto-dismisses", async () => {
    vi.useFakeTimers();
    try {
      const confirm = vi
        .spyOn(client, "confirmClaim")
        .mockResolvedValue({ player: { level: 1, xp: 0 }, merged: false } as never);
      window.history.replaceState(null, "", "/?claim=tok123&x=1");
      const onConfirmed = vi.fn();

      render(<Harness onConfirmed={onConfirmed} />);

      // The confirm call resolves; flush the microtask/state updates.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(confirm).toHaveBeenCalledWith("tok123");
      expect(onConfirmed).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("notice").textContent).toMatch(/progress is saved/i);
      // The spent token is removed from the URL, other params kept.
      expect(window.location.search).toBe("?x=1");

      // It clears itself after the timeout instead of lingering.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLAIM_NOTICE_MS);
      });
      expect(screen.getByTestId("notice").textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an error notice when the link is invalid", async () => {
    vi.spyOn(client, "confirmClaim").mockRejectedValue(new Error("bad"));
    window.history.replaceState(null, "", "/?claim=nope");
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId("notice").textContent).toMatch(/invalid or expired/i),
    );
  });
});

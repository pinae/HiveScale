/**
 * WP-10: SessionHeader — brand + running score, with the streak flame gated.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import SessionHeader from "./SessionHeader";

describe("SessionHeader", () => {
  it("shows the brand and the running score", () => {
    render(<SessionHeader xp={4212} level={3} streak={0} />);
    expect(screen.getByRole("heading", { name: /hivescale/i })).toBeInTheDocument();
    expect(screen.getByTestId("session-level")).toHaveTextContent("3");
    expect(screen.getByTestId("session-xp")).toHaveTextContent("4212");
  });

  it("hides the flame below a hot streak and shows it at 3+", () => {
    const { rerender } = render(<SessionHeader xp={0} level={1} streak={2} />);
    expect(screen.queryByLabelText(/hot streak/i)).not.toBeInTheDocument();
    rerender(<SessionHeader xp={0} level={1} streak={4} />);
    expect(screen.getByLabelText(/hot streak: 4/i)).toBeInTheDocument();
  });

  it("offers to save progress when unclaimed, and confirms once claimed", async () => {
    const onClaim = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <SessionHeader xp={0} level={1} streak={0} onClaim={onClaim} isClaimed={false} />,
    );
    await user.click(screen.getByRole("button", { name: /save progress/i }));
    expect(onClaim).toHaveBeenCalledOnce();

    rerender(<SessionHeader xp={0} level={1} streak={0} onClaim={onClaim} isClaimed />);
    expect(screen.queryByRole("button", { name: /save progress/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("session-saved")).toBeInTheDocument();
  });

  it("shows the XP multiplier only above ×1, and a level progress bar", () => {
    const progress = { level: 3, xp: 5000, into_level: 3500, level_span: 7000, next_level_xp: 8000 };
    const { rerender } = render(<SessionHeader xp={5000} level={3} streak={0} multiplier={1} />);
    expect(screen.queryByTestId("session-multiplier")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-progress")).not.toBeInTheDocument();

    rerender(<SessionHeader xp={5000} level={3} streak={0} multiplier={4} progress={progress} />);
    expect(screen.getByTestId("session-multiplier")).toHaveTextContent("×4");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  });
});

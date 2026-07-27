/**
 * WP-10: SessionHeader — brand + running score, with the streak flame gated.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SessionHeader from "./SessionHeader";

describe("SessionHeader", () => {
  it("shows the brand and the running score", () => {
    render(<SessionHeader xp={4212} level={3} streak={0} />);
    expect(screen.getByRole("heading", { name: /baseline guesser/i })).toBeInTheDocument();
    expect(screen.getByTestId("session-level")).toHaveTextContent("3");
    expect(screen.getByTestId("session-xp")).toHaveTextContent("4212");
  });

  it("hides the flame below a hot streak and shows it at 3+", () => {
    const { rerender } = render(<SessionHeader xp={0} level={1} streak={2} />);
    expect(screen.queryByLabelText(/hot streak/i)).not.toBeInTheDocument();
    rerender(<SessionHeader xp={0} level={1} streak={4} />);
    expect(screen.getByLabelText(/hot streak: 4/i)).toBeInTheDocument();
  });
});

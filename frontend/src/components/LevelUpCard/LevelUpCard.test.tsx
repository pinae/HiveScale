import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import LevelUpCard from "./LevelUpCard";

describe("LevelUpCard", () => {
  it("explains the multiplier at level 2 and dismisses on the button", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<LevelUpCard level={2} onDismiss={onDismiss} />);

    const dialog = screen.getByRole("dialog", { name: /multiplier unlocked/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/70% of the crowd/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /got it/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("names the right capability for each milestone", () => {
    const { rerender } = render(<LevelUpCard level={5} onDismiss={() => {}} />);
    expect(screen.getByRole("dialog", { name: /voting unlocked/i })).toBeInTheDocument();
    rerender(<LevelUpCard level={10} onDismiss={() => {}} />);
    expect(screen.getByRole("dialog", { name: /challenges unlocked/i })).toBeInTheDocument();
    rerender(<LevelUpCard level={15} onDismiss={() => {}} />);
    expect(screen.getByRole("dialog", { name: /scale requests unlocked/i })).toBeInTheDocument();
  });

  it("dismisses on Escape", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<LevelUpCard level={10} onDismiss={onDismiss} />);
    await user.keyboard("{Escape}");
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

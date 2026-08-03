/**
 * IntervalHandle — one draggable edge of the confidence band.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import IntervalHandle from "./IntervalHandle";

describe("IntervalHandle", () => {
  it("renders an accessible slider at its position", () => {
    render(<IntervalHandle label="Interval lower bound" position={40} />);
    const handle = screen.getByRole("slider", { name: /lower bound/i });
    expect(handle).toHaveAttribute("aria-valuenow", "40");
    expect(handle).toHaveAttribute("aria-valuemin", "0");
    expect(handle).toHaveAttribute("aria-valuemax", "100");
  });

  it("nudges by ±step on arrow keys", () => {
    const onNudge = vi.fn();
    render(<IntervalHandle label="Interval upper bound" position={60} onNudge={onNudge} />);
    const handle = screen.getByRole("slider", { name: /upper bound/i });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onNudge).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onNudge).toHaveBeenLastCalledWith(-1);
  });

  it("is inert and unfocusable when disabled", () => {
    const onNudge = vi.fn();
    render(
      <IntervalHandle label="Interval lower bound" position={40} disabled onNudge={onNudge} />,
    );
    const handle = screen.getByRole("slider", { name: /lower bound/i });
    expect(handle).toHaveAttribute("aria-disabled", "true");
    expect(handle).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onNudge).not.toHaveBeenCalled();
  });
});

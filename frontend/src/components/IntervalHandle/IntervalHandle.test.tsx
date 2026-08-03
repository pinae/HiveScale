/**
 * IntervalHandle — one σ (spread) knob of the guess bell.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import IntervalHandle from "./IntervalHandle";

describe("IntervalHandle", () => {
  it("renders an accessible spread slider (0…sigmaMax) at its σ", () => {
    render(<IntervalHandle label="Left spread" sigma={22} sigmaMax={100} leftFraction={0.3} />);
    const handle = screen.getByRole("slider", { name: /left spread/i });
    expect(handle).toHaveAttribute("aria-valuenow", "22");
    expect(handle).toHaveAttribute("aria-valuemin", "0");
    expect(handle).toHaveAttribute("aria-valuemax", "100");
    expect(handle).toHaveStyle({ left: "30%" });
  });

  it("marks an off-scale handle and drops it below the rail", () => {
    render(
      <IntervalHandle label="Right spread" sigma={60} sigmaMax={100} leftFraction={1} dropPx={72} offScale />,
    );
    const handle = screen.getByRole("slider", { name: /right spread/i });
    expect(handle).toHaveAttribute("data-offscale", "true");
    expect(handle.getAttribute("aria-valuetext")).toMatch(/past the scale/i);
    expect(handle).toHaveStyle({ "--bsg-handle-drop-px": "72px" });
  });

  it("squares the corner nearest the scale via data-point", () => {
    render(
      <IntervalHandle label="Left spread" sigma={10} sigmaMax={100} leftFraction={0.3} pointSide="left" />,
    );
    expect(screen.getByRole("slider", { name: /left spread/i })).toHaveAttribute("data-point", "left");
  });

  it("nudges by ±step on arrow keys", () => {
    const onNudge = vi.fn();
    render(
      <IntervalHandle label="Right spread" sigma={12} sigmaMax={100} leftFraction={0.6} onNudge={onNudge} />,
    );
    const handle = screen.getByRole("slider", { name: /right spread/i });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onNudge).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onNudge).toHaveBeenLastCalledWith(-1);
  });

  it("is inert and unfocusable when disabled", () => {
    const onNudge = vi.fn();
    render(
      <IntervalHandle
        label="Left spread"
        sigma={12}
        sigmaMax={100}
        leftFraction={0.4}
        disabled
        onNudge={onNudge}
      />,
    );
    const handle = screen.getByRole("slider", { name: /left spread/i });
    expect(handle).toHaveAttribute("aria-disabled", "true");
    expect(handle).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onNudge).not.toHaveBeenCalled();
  });
});

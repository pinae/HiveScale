/**
 * WP-08 red tests: WaveSlider — the one-thumb guess control.
 *
 * Interaction + a11y spec (plan §1.3 / §2.1 / WP-08):
 * - controlled: emits the full {center, widthLeft, widthRight} on every change;
 * - ARIA slider semantics on the centre thumb and both interval bounds;
 * - keyboard: arrows move the centre, shift+arrows resize the interval,
 *   Home/End jump to the poles;
 * - pointer: pressing the track sets the centre, dragging tracks the pointer;
 * - disabled: inert to keyboard and pointer.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import WaveSlider, { type GuessValue } from "./WaveSlider";

function Harness({
  initial = { center: 50, widthLeft: 10, widthRight: 10 },
  disabled = false,
}: {
  initial?: GuessValue;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<GuessValue>(initial);
  return <WaveSlider value={value} onChange={setValue} disabled={disabled} />;
}

function mockTrackWidth(container: HTMLElement, width = 200) {
  const track = container.querySelector<HTMLElement>('[data-testid="wave-slider-track"]')!;
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
    left: 0, right: width, width, top: 0, bottom: 20, height: 20, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return track;
}

const guess = () => screen.getByRole("slider", { name: /your guess/i });
const lower = () => screen.getByRole("slider", { name: /lower bound/i });
const upper = () => screen.getByRole("slider", { name: /upper bound/i });

describe("WaveSlider", () => {
  it("exposes ARIA slider semantics for the guess and both interval bounds", () => {
    render(<Harness />);
    expect(guess()).toHaveAttribute("aria-valuemin", "0");
    expect(guess()).toHaveAttribute("aria-valuemax", "100");
    expect(guess()).toHaveAttribute("aria-valuenow", "50");
    expect(guess()).toHaveAttribute("aria-orientation", "horizontal");
    expect(lower()).toHaveAttribute("aria-valuenow", "40");
    expect(upper()).toHaveAttribute("aria-valuenow", "60");
  });

  it("moves the centre with arrow keys and jumps to the poles with Home/End", () => {
    render(<Harness />);
    guess().focus();
    fireEvent.keyDown(guess(), { key: "ArrowRight" });
    expect(guess()).toHaveAttribute("aria-valuenow", "51");
    fireEvent.keyDown(guess(), { key: "ArrowLeft" });
    expect(guess()).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(guess(), { key: "Home" });
    expect(guess()).toHaveAttribute("aria-valuenow", "0");
    fireEvent.keyDown(guess(), { key: "End" });
    expect(guess()).toHaveAttribute("aria-valuenow", "100");
  });

  it("resizes the interval symmetrically with shift+arrows", () => {
    render(<Harness />);
    fireEvent.keyDown(guess(), { key: "ArrowRight", shiftKey: true }); // widen
    expect(lower()).toHaveAttribute("aria-valuenow", "39");
    expect(upper()).toHaveAttribute("aria-valuenow", "61");
    fireEvent.keyDown(guess(), { key: "ArrowLeft", shiftKey: true }); // narrow back
    expect(lower()).toHaveAttribute("aria-valuenow", "40");
    expect(upper()).toHaveAttribute("aria-valuenow", "60");
  });

  it("lets each interval bound be nudged independently (asymmetric)", () => {
    render(<Harness />);
    fireEvent.keyDown(lower(), { key: "ArrowRight" }); // lower bound moves inward
    expect(lower()).toHaveAttribute("aria-valuenow", "41");
    expect(upper()).toHaveAttribute("aria-valuenow", "60"); // unchanged
  });

  it("sets the centre from a pointer press on the track and follows the drag", () => {
    const { container } = render(<Harness />);
    mockTrackWidth(container, 200);
    fireEvent.pointerDown(container.querySelector('[data-testid="wave-slider-track"]')!, {
      clientX: 150, pointerId: 1,
    });
    expect(guess()).toHaveAttribute("aria-valuenow", "75");
    fireEvent.pointerMove(window, { clientX: 40, pointerId: 1 });
    expect(guess()).toHaveAttribute("aria-valuenow", "20");
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("emits the whole guess shape on change", () => {
    const onChange = vi.fn();
    render(
      <WaveSlider value={{ center: 50, widthLeft: 10, widthRight: 10 }} onChange={onChange} />,
    );
    fireEvent.keyDown(screen.getByRole("slider", { name: /your guess/i }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ center: 51, widthLeft: 10, widthRight: 10 });
  });

  it("is inert when disabled", () => {
    const { container } = render(<Harness disabled />);
    expect(guess()).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(guess(), { key: "ArrowRight" });
    expect(guess()).toHaveAttribute("aria-valuenow", "50");
    mockTrackWidth(container, 200);
    fireEvent.pointerDown(container.querySelector('[data-testid="wave-slider-track"]')!, {
      clientX: 150, pointerId: 1,
    });
    expect(guess()).toHaveAttribute("aria-valuenow", "50");
  });
});

/**
 * WP-08: WaveSlider DOM behaviour. The interval maths are proven in
 * interval-model.test.ts; here we pin the gesture wiring — including the bugs
 * the rework fixed: interval ends are draggable independently and pressing them
 * no longer jumps the centre.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import WaveSlider, { type GuessValue } from "./WaveSlider";

function Harness({
  initial = { center: 50, widthLeft: 12, widthRight: 12 },
  disabled = false,
}: {
  initial?: GuessValue;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<GuessValue>(initial);
  return <WaveSlider value={value} onChange={setValue} disabled={disabled} />;
}

function mockTrack(container: HTMLElement, width = 200, height = 40) {
  const track = container.querySelector<HTMLElement>('[data-testid="wave-slider-track"]')!;
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
    left: 0, right: width, width, top: 0, bottom: height, height, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return track;
}

const guess = () => screen.getByRole("slider", { name: /your guess/i });
const lower = () => screen.getByRole("slider", { name: /lower bound/i });
const upper = () => screen.getByRole("slider", { name: /upper bound/i });
const now = (el: HTMLElement) => el.getAttribute("aria-valuenow");

describe("WaveSlider — ARIA & keyboard", () => {
  it("exposes slider semantics for the guess and both interval bounds", () => {
    render(<Harness />);
    expect(guess()).toHaveAttribute("aria-valuemin", "0");
    expect(guess()).toHaveAttribute("aria-valuemax", "100");
    expect(guess()).toHaveAttribute("aria-valuenow", "50");
    expect(guess()).toHaveAttribute("aria-orientation", "horizontal");
    expect(now(lower())).toBe("38");
    expect(now(upper())).toBe("62");
  });

  it("moves the centre with arrows and jumps to the poles with Home/End", () => {
    render(<Harness />);
    fireEvent.keyDown(guess(), { key: "ArrowRight" });
    expect(now(guess())).toBe("51");
    fireEvent.keyDown(guess(), { key: "Home" });
    expect(now(guess())).toBe("0");
    fireEvent.keyDown(guess(), { key: "End" });
    expect(now(guess())).toBe("100");
  });

  it("resizes symmetrically with shift+arrows", () => {
    render(<Harness />);
    fireEvent.keyDown(guess(), { key: "ArrowRight", shiftKey: true });
    expect(now(lower())).toBe("37");
    expect(now(upper())).toBe("63");
  });

  it("nudges each bound independently with its own arrows", () => {
    render(<Harness />);
    fireEvent.keyDown(lower(), { key: "ArrowRight" }); // lower bound inward
    expect(now(lower())).toBe("39");
    expect(now(upper())).toBe("62"); // untouched
    expect(now(guess())).toBe("50"); // centre untouched
  });

  it("emits the whole guess shape", () => {
    const onChange = vi.fn();
    render(<WaveSlider value={{ center: 50, widthLeft: 12, widthRight: 12 }} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: /your guess/i }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ center: 51, widthLeft: 12, widthRight: 12 });
  });
});

describe("WaveSlider — pointer", () => {
  it("drags the white dot: the interval travels with the centre", () => {
    const { container } = render(<Harness />);
    mockTrack(container);
    fireEvent.pointerDown(guess(), { clientX: 100, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 20, pointerId: 1 });
    expect(now(guess())).toBe("75");
    expect(now(lower())).toBe("63"); // 75 - 12
    expect(now(upper())).toBe("87"); // 75 + 12
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("drags an interval end independently without moving the centre", () => {
    const { container } = render(<Harness />);
    mockTrack(container);
    fireEvent.pointerDown(upper(), { clientX: 124, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 140, clientY: 20, pointerId: 1 }); // -> 70
    expect(now(upper())).toBe("70");
    expect(now(lower())).toBe("38"); // untouched
    expect(now(guess())).toBe("50"); // centre stays put
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("pressing an interval end does not jump the centre (the reported bug)", () => {
    const { container } = render(<Harness />);
    mockTrack(container);
    fireEvent.pointerDown(lower(), { clientX: 10, clientY: 20, pointerId: 1 });
    expect(now(guess())).toBe("50"); // would have jumped toward 10 before the fix
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("tapping empty track places the centre there", () => {
    const { container } = render(<Harness />);
    const track = mockTrack(container);
    fireEvent.pointerDown(track, { clientX: 30, clientY: 20, pointerId: 1 });
    expect(now(guess())).toBe("15"); // 30/200 * 100
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("squashes a side at the wall and restores it on the way back", () => {
    const { container } = render(<Harness initial={{ center: 20, widthLeft: 20, widthRight: 20 }} />);
    mockTrack(container);
    fireEvent.pointerDown(guess(), { clientX: 40, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 20, pointerId: 1 }); // centre -> 0
    expect(now(lower())).toBe("0");
    expect(now(upper())).toBe("20");
    fireEvent.pointerMove(window, { clientX: 50, clientY: 20, pointerId: 1 }); // centre -> 25
    expect(now(lower())).toBe("5"); // left side grew back
    expect(now(upper())).toBe("45");
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("scales symmetrically when the drag goes far above/below the track", () => {
    const { container } = render(<Harness />);
    mockTrack(container, 200, 40); // midY = 20, threshold = 40px
    fireEvent.pointerDown(guess(), { clientX: 100, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 100, pointerId: 1 }); // dy 80 -> overflow 40px -> 20 units
    expect(now(lower())).toBe("30");
    expect(now(upper())).toBe("70");
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("resizes with the wheel while the dot is focused", () => {
    const { container } = render(<Harness />);
    const track = mockTrack(container);
    guess().focus();
    fireEvent.wheel(track, { deltaY: -100 }); // wider by WHEEL_STEP (3): 12 -> 15
    expect(now(lower())).toBe("35");
    expect(now(upper())).toBe("65");
  });
});

describe("WaveSlider — disabled", () => {
  it("ignores keyboard and pointer", () => {
    const { container } = render(<Harness disabled />);
    expect(guess()).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(guess(), { key: "ArrowRight" });
    expect(now(guess())).toBe("50");
    const track = mockTrack(container);
    fireEvent.pointerDown(track, { clientX: 150, clientY: 20, pointerId: 1 });
    expect(now(guess())).toBe("50");
  });
});

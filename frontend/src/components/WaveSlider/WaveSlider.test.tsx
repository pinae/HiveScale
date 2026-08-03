/**
 * WaveSlider DOM behaviour. The interval maths are proven in
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
const leftSigma = () => screen.getByRole("slider", { name: /left spread/i });
const rightSigma = () => screen.getByRole("slider", { name: /right spread/i });
const now = (el: HTMLElement) => el.getAttribute("aria-valuenow");

describe("WaveSlider — ARIA & keyboard", () => {
  it("exposes slider semantics: the centre on the scale, each σ as a 0…span spread", () => {
    render(<Harness />);
    expect(guess()).toHaveAttribute("aria-valuemin", "0");
    expect(guess()).toHaveAttribute("aria-valuemax", "100");
    expect(guess()).toHaveAttribute("aria-valuenow", "50");
    expect(guess()).toHaveAttribute("aria-orientation", "horizontal");
    // The σ handles report the standard deviation, 0…span (100), not a position.
    expect(leftSigma()).toHaveAttribute("aria-valuemax", "100");
    expect(now(leftSigma())).toBe("12");
    expect(now(rightSigma())).toBe("12");
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

  it("accumulates rapid keypresses that land before a re-render", () => {
    // A fast agent (or CI) fires several keydowns inside one React tick, before
    // the controlled value re-renders. Each must build on the previous emit, not
    // the stale render-time value — else the presses collapse into a single step.
    // Value is held fixed here (spy onChange, no state) to model that window.
    const onChange = vi.fn();
    const value: GuessValue = { center: 50, widthLeft: 12, widthRight: 12 };
    render(<WaveSlider value={value} onChange={onChange} />);
    const thumb = screen.getByRole("slider", { name: /your guess/i });

    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    fireEvent.keyDown(thumb, { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange.mock.calls[2][0].center).toBe(53);
  });

  it("resizes both sides with shift+arrows", () => {
    render(<Harness />);
    fireEvent.keyDown(guess(), { key: "ArrowRight", shiftKey: true });
    expect(now(leftSigma())).toBe("13");
    expect(now(rightSigma())).toBe("13");
  });

  it("nudges each side's σ independently with the handle's own arrows", () => {
    render(<Harness />);
    fireEvent.keyDown(leftSigma(), { key: "ArrowRight" }); // grow the left spread
    expect(now(leftSigma())).toBe("13");
    expect(now(rightSigma())).toBe("12"); // untouched
    expect(now(guess())).toBe("50"); // centre untouched
  });

  it("keyboard grows σ past the wall (off the scale)", () => {
    render(<Harness initial={{ center: 96, widthLeft: 12, widthRight: 4 }} />);
    // Right wall is 4; nudging up keeps growing σ beyond it.
    for (let i = 0; i < 10; i++) fireEvent.keyDown(rightSigma(), { key: "ArrowUp" });
    expect(now(rightSigma())).toBe("14"); // 4 + 10, well past the wall
    expect(rightSigma()).toHaveAttribute("data-offscale", "true");
  });

  it("emits the whole guess shape", () => {
    const onChange = vi.fn();
    render(<WaveSlider value={{ center: 50, widthLeft: 12, widthRight: 12 }} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: /your guess/i }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ center: 51, widthLeft: 12, widthRight: 12 });
  });
});

describe("WaveSlider — pointer", () => {
  it("drags the white dot: the centre moves, the σ ride along unchanged", () => {
    const { container } = render(<Harness />);
    mockTrack(container);
    fireEvent.pointerDown(guess(), { clientX: 100, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 20, pointerId: 1 });
    expect(now(guess())).toBe("75");
    expect(now(leftSigma())).toBe("12"); // spread unchanged by a horizontal move
    expect(now(rightSigma())).toBe("12");
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("drags a σ handle to set that side's spread, without moving the centre", () => {
    const { container } = render(<Harness />);
    mockTrack(container);
    fireEvent.pointerDown(rightSigma(), { clientX: 124, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 140, clientY: 20, pointerId: 1 }); // value 70 -> σ 20
    expect(now(rightSigma())).toBe("20");
    expect(now(leftSigma())).toBe("12"); // untouched
    expect(now(guess())).toBe("50"); // centre stays put
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("pushes a σ handle past the wall by dragging down the wall-drop", () => {
    const { container } = render(<Harness initial={{ center: 95, widthLeft: 12, widthRight: 5 }} />);
    mockTrack(container, 200, 40); // bottom 40 + rail-offset 5 -> corner at y = 45
    fireEvent.pointerDown(rightSigma(), { clientX: 200, clientY: 45, pointerId: 1 }); // at the wall
    // Drag 16px down the 80px wall-drop. That fraction (16/80) of the remaining
    // span to the cap (100 - 5 = 95) lands on σ = 5 + 0.2 * 95 = 24.
    fireEvent.pointerMove(window, { clientX: 200, clientY: 61, pointerId: 1 });
    expect(now(rightSigma())).toBe("24");
    expect(rightSigma()).toHaveAttribute("data-offscale", "true");
    expect(now(guess())).toBe("95"); // centre untouched
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("pressing a σ handle does not jump the centre", () => {
    const { container } = render(<Harness />);
    mockTrack(container);
    fireEvent.pointerDown(leftSigma(), { clientX: 10, clientY: 20, pointerId: 1 });
    expect(now(guess())).toBe("50");
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("tapping empty track places the centre there", () => {
    const { container } = render(<Harness />);
    const track = mockTrack(container);
    fireEvent.pointerDown(track, { clientX: 30, clientY: 20, pointerId: 1 });
    expect(now(guess())).toBe("15"); // 30/200 * 100
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("a horizontal dot-drag preserves the σ as the centre crosses a wall", () => {
    const { container } = render(<Harness initial={{ center: 20, widthLeft: 20, widthRight: 20 }} />);
    mockTrack(container);
    fireEvent.pointerDown(guess(), { clientX: 40, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 0, clientY: 20, pointerId: 1 }); // centre -> 0
    expect(now(guess())).toBe("0");
    expect(now(leftSigma())).toBe("20"); // σ kept even though the display clamps
    expect(now(rightSigma())).toBe("20");
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("widens when the drag goes up, narrows when it goes down", () => {
    const { container } = render(<Harness />);
    mockTrack(container, 200, 40); // midY = 20, dead-zone = 40px, 0.5 units/px
    fireEvent.pointerDown(guess(), { clientX: 100, clientY: 20, pointerId: 1 });
    // Up past the dead-zone: dy 60 -> 20px -> +10 on both σ (12 -> 22).
    fireEvent.pointerMove(window, { clientX: 100, clientY: -40, pointerId: 1 });
    expect(now(leftSigma())).toBe("22");
    expect(now(rightSigma())).toBe("22");
    // Down past the dead-zone: relative to the grab, -10 (12 -> 2).
    fireEvent.pointerMove(window, { clientX: 100, clientY: 80, pointerId: 1 });
    expect(now(leftSigma())).toBe("2");
    expect(now(rightSigma())).toBe("2");
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("the centre widen now grows both sides past the wall together (symmetric)", () => {
    const { container } = render(<Harness initial={{ center: 20, widthLeft: 5, widthRight: 5 }} />);
    mockTrack(container, 200, 40);
    fireEvent.pointerDown(guess(), { clientX: 40, clientY: 20, pointerId: 1 }); // centre stays 20
    fireEvent.pointerMove(window, { clientX: 40, clientY: -100, pointerId: 1 }); // +40 both sides
    expect(now(leftSigma())).toBe("45"); // left no longer stops at the wall
    expect(now(rightSigma())).toBe("45");
    fireEvent.pointerUp(window, { pointerId: 1 });
  });

  it("resizes with the wheel while the dot is focused", () => {
    const { container } = render(<Harness />);
    const track = mockTrack(container);
    guess().focus();
    fireEvent.wheel(track, { deltaY: -100 }); // wider by WHEEL_STEP (3): 12 -> 15
    expect(now(leftSigma())).toBe("15");
    expect(now(rightSigma())).toBe("15");
  });
});

describe("WaveSlider — bell visualization", () => {
  it("renders the distribution curve above the scale and moves its peak with the centre", () => {
    const { container, rerender } = render(
      <WaveSlider value={{ center: 30, widthLeft: 12, widthRight: 12 }} onChange={() => {}} />,
    );
    const curve = container.querySelector<SVGSVGElement>('[data-testid="wave-slider-curve"]')!;
    expect(curve).toBeTruthy();
    const peak = curve.querySelector<SVGLineElement>(".bsg-slider-bell-peak")!;
    const at30 = Number(peak.getAttribute("x1"));

    rerender(<WaveSlider value={{ center: 70, widthLeft: 12, widthRight: 12 }} onChange={() => {}} />);
    const at70 = Number(peak.getAttribute("x1"));
    expect(at70).toBeGreaterThan(at30); // peak follows the centre rightward
  });

  it("mirrors the peak position under rtl", () => {
    const { container } = render(
      <WaveSlider value={{ center: 30, widthLeft: 10, widthRight: 10 }} onChange={() => {}} dir="rtl" />,
    );
    const peak = container.querySelector<SVGLineElement>(".bsg-slider-bell-peak")!;
    // Centre 30 in rtl sits on the right: x = (1 - 0.3) * 1000 = 700.
    expect(Number(peak.getAttribute("x1"))).toBeCloseTo(700, 0);
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

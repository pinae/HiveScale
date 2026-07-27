/**
 * One draggable edge of the confidence interval. Presentational + accessible:
 * it renders an ARIA slider knob at `position` and reports keyboard nudges and
 * pointer presses upward; WaveSlider owns the interval maths.
 */
import type { KeyboardEvent, PointerEvent } from "react";

export interface IntervalHandleProps {
  /** Accessible name, e.g. "Interval lower bound". */
  label: string;
  /** Where the knob sits on the scale, in `[min, max]`. */
  position: number;
  min?: number;
  max?: number;
  /** Keyboard/pointer granularity for a single nudge. */
  step?: number;
  disabled?: boolean;
  /** Called with a signed multiple of `step` when an arrow key is pressed. */
  onNudge?: (delta: number) => void;
  /** Forwarded so WaveSlider can start a pointer drag. */
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  /** `rtl` mirrors the knob's horizontal placement. */
  dir?: "ltr" | "rtl";
}

export default function IntervalHandle({
  label,
  position,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  onNudge,
  onPointerDown,
  dir = "ltr",
}: IntervalHandleProps) {
  const ratio = max > min ? (position - min) / (max - min) : 0;
  const left = dir === "rtl" ? 1 - ratio : ratio;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onNudge?.(step);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onNudge?.(-step);
    }
  }

  return (
    <div
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(position)}
      aria-disabled={disabled || undefined}
      aria-orientation="horizontal"
      tabIndex={disabled ? -1 : 0}
      className="bsg-interval-handle"
      data-disabled={disabled || undefined}
      style={{ left: `${left * 100}%` }}
      onKeyDown={handleKeyDown}
      onPointerDown={disabled ? undefined : onPointerDown}
    />
  );
}

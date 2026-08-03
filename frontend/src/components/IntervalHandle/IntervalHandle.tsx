/**
 * One σ (standard-deviation) handle of the guess bell. Presentational +
 * accessible: it renders an ARIA slider knob on the sub-rail beneath the scale
 * and reports keyboard nudges and pointer presses upward; WaveSlider owns the
 * geometry (where along the rail it sits, and how far it has dropped below the
 * wall) and the σ maths.
 */
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";

export interface IntervalHandleProps {
  /** Accessible name, e.g. "Left spread". */
  label: string;
  /** Current σ, for `aria-valuenow` (0…`sigmaMax`). */
  sigma: number;
  /** The largest σ (full scale span), for `aria-valuemax`. */
  sigmaMax: number;
  /** Screen position across the track, 0 (left) → 1 (right), already RTL-mirrored. */
  leftFraction: number;
  /** How far below the rail the knob hangs, 0 (on the rail) → 1 (σ = max). */
  drop?: number;
  /** True when σ has passed the wall and the knob is dropped off the scale. */
  offScale?: boolean;
  /** Visual side of the scale, so the corner nearest it is squared into a drop. */
  pointSide?: "left" | "right";
  disabled?: boolean;
  /** Called with a signed multiple of `step` when an arrow key is pressed. */
  onNudge?: (delta: number) => void;
  /** Keyboard granularity for a single nudge. */
  step?: number;
  /** Forwarded so WaveSlider can start a pointer drag. */
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
}

export default function IntervalHandle({
  label,
  sigma,
  sigmaMax,
  leftFraction,
  drop = 0,
  offScale = false,
  pointSide,
  disabled = false,
  onNudge,
  step = 1,
  onPointerDown,
}: IntervalHandleProps) {
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

  const rounded = Math.round(sigma);
  return (
    <div
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(sigmaMax)}
      aria-valuenow={rounded}
      aria-valuetext={offScale ? `spread ${rounded}, past the scale edge` : `spread ${rounded}`}
      aria-disabled={disabled || undefined}
      aria-orientation="horizontal"
      tabIndex={disabled ? -1 : 0}
      className="bsg-interval-handle"
      data-disabled={disabled || undefined}
      data-offscale={offScale || undefined}
      data-point={pointSide}
      style={{ left: `${leftFraction * 100}%`, "--bsg-handle-drop": drop } as CSSProperties}
      onKeyDown={handleKeyDown}
      onPointerDown={disabled ? undefined : onPointerDown}
    />
  );
}

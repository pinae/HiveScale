/**
 * WaveSlider (WP-08): the one-thumb guess control.
 *
 * A player places a Thing on a 0-100 scale (`center`) and expresses confidence
 * by stretching an interval around it (`widthLeft`, `widthRight`). The control
 * is fully controlled and one-thumb friendly (plan §2.1):
 *
 * - the whole track is a press target — tapping sets the centre and starts a
 *   drag that follows the pointer;
 * - the centre thumb is an ARIA slider: arrows move it, shift+arrows resize the
 *   interval symmetrically, Home/End/PageUp/PageDown for coarse jumps;
 * - each interval bound is its own slider for fine, asymmetric adjustment;
 * - a subtle haptic tick fires at the poles and the midpoint where supported.
 *
 * All geometry stays in `[0, 100]`; widths never push a bound past a pole.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import IntervalHandle from "../IntervalHandle";

export interface GuessValue {
  center: number;
  widthLeft: number;
  widthRight: number;
}

export interface WaveSliderProps {
  value: GuessValue;
  onChange: (next: GuessValue) => void;
  min?: number;
  max?: number;
  /** Nudge granularity for arrow keys. */
  step?: number;
  /** Coarse granularity for PageUp/PageDown. */
  bigStep?: number;
  disabled?: boolean;
  dir?: "ltr" | "rtl";
  /** Accessible name for the centre thumb. */
  label?: string;
}

type DragTarget = "center" | "lower" | "upper";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function hapticTick(center: number, min: number, max: number) {
  const mid = (min + max) / 2;
  if ((center === min || center === max || center === mid) &&
      typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(8);
  }
}

export default function WaveSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  bigStep = 10,
  disabled = false,
  dir = "ltr",
  label = "Your guess",
}: WaveSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    // Keep the latest value/callback reachable from the drag listeners without
    // re-subscribing them on every change.
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  const [drag, setDrag] = useState<DragTarget | null>(null);

  const { center, widthLeft, widthRight } = value;
  const lowerBound = clamp(center - widthLeft, min, center);
  const upperBound = clamp(center + widthRight, center, max);
  const toRatio = (v: number) => (max > min ? (v - min) / (max - min) : 0);
  const toLeft = (v: number) => (dir === "rtl" ? 1 - toRatio(v) : toRatio(v));

  const emit = useCallback(
    (next: GuessValue) => {
      const clamped: GuessValue = {
        center: clamp(next.center, min, max),
        widthLeft: clamp(next.widthLeft, 0, next.center - min),
        widthRight: clamp(next.widthRight, 0, max - next.center),
      };
      hapticTick(clamped.center, min, max);
      onChangeRef.current(clamped);
    },
    [min, max],
  );

  const positionFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return valueRef.current.center;
      const rect = track.getBoundingClientRect();
      let ratio = rect.width ? (clientX - rect.left) / rect.width : 0;
      if (dir === "rtl") ratio = 1 - ratio;
      const raw = min + clamp(ratio, 0, 1) * (max - min);
      return clamp(Math.round(raw / step) * step, min, max);
    },
    [dir, min, max, step],
  );

  const applyDrag = useCallback(
    (target: DragTarget, clientX: number) => {
      const pos = positionFromClientX(clientX);
      const current = valueRef.current;
      if (target === "center") {
        emit({ ...current, center: pos });
      } else if (target === "lower") {
        emit({ ...current, widthLeft: current.center - pos });
      } else {
        emit({ ...current, widthRight: pos - current.center });
      }
    },
    [emit, positionFromClientX],
  );

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: globalThis.PointerEvent) => applyDrag(drag, event.clientX);
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, applyDrag]);

  function startDrag(target: DragTarget, event: PointerEvent<HTMLElement>) {
    if (disabled) return;
    event.preventDefault();
    setDrag(target);
    applyDrag(target, event.clientX);
  }

  function handleCenterKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const widen = (delta: number) =>
      emit({ ...value, widthLeft: widthLeft + delta, widthRight: widthRight + delta });
    const moveTo = (next: number) => emit({ ...value, center: next });

    let handled = true;
    if (event.shiftKey) {
      if (event.key === "ArrowRight" || event.key === "ArrowUp") widen(step);
      else if (event.key === "ArrowLeft" || event.key === "ArrowDown") widen(-step);
      else handled = false;
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") moveTo(center + step);
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") moveTo(center - step);
    else if (event.key === "PageUp") moveTo(center + bigStep);
    else if (event.key === "PageDown") moveTo(center - bigStep);
    else if (event.key === "Home") moveTo(min);
    else if (event.key === "End") moveTo(max);
    else handled = false;

    if (handled) event.preventDefault();
  }

  const nudgeLower = (delta: number) => emit({ ...value, widthLeft: widthLeft - delta });
  const nudgeUpper = (delta: number) => emit({ ...value, widthRight: widthRight + delta });

  return (
    <div className="bsg-slider" data-disabled={disabled || undefined} dir={dir}>
      <div
        ref={trackRef}
        className="bsg-slider-track"
        data-testid="wave-slider-track"
        data-dragging={drag || undefined}
        onPointerDown={(event) => startDrag("center", event)}
      >
        <div className="bsg-slider-rail" aria-hidden="true" />
        {[0, 50, 100].map((tick) => (
          <span
            key={tick}
            className="bsg-slider-tick"
            aria-hidden="true"
            style={{ left: `${toLeft(tick) * 100}%` }}
          />
        ))}
        <div
          className="bsg-slider-band"
          aria-hidden="true"
          style={{
            left: `${Math.min(toLeft(lowerBound), toLeft(upperBound)) * 100}%`,
            width: `${Math.abs(toLeft(upperBound) - toLeft(lowerBound)) * 100}%`,
          }}
        />
        <IntervalHandle
          label="Interval lower bound"
          position={lowerBound}
          min={min}
          max={max}
          step={step}
          dir={dir}
          disabled={disabled}
          onNudge={nudgeLower}
          onPointerDown={(event) => startDrag("lower", event)}
        />
        <IntervalHandle
          label="Interval upper bound"
          position={upperBound}
          min={min}
          max={max}
          step={step}
          dir={dir}
          disabled={disabled}
          onNudge={nudgeUpper}
          onPointerDown={(event) => startDrag("upper", event)}
        />
        <div
          role="slider"
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={Math.round(center)}
          aria-valuetext={`${Math.round(center)}, interval ${Math.round(lowerBound)} to ${Math.round(upperBound)}`}
          aria-orientation="horizontal"
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          className="bsg-slider-thumb"
          style={{ left: `${toLeft(center) * 100}%` }}
          onKeyDown={handleCenterKeyDown}
          onPointerDown={(event) => {
            event.stopPropagation();
            startDrag("center", event);
          }}
        />
      </div>
    </div>
  );
}

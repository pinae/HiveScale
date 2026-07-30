/**
 * WaveSlider (WP-08): the one-thumb guess control.
 *
 * A player places a Thing on a 0-100 scale (`center`) and stretches a confidence
 * interval around it. All interval maths live in `interval-model.ts`; this file
 * is the thin translation of gestures to those pure calls:
 *
 * - **white dot** — drag to move the centre; the interval travels with it and a
 *   side squashed against a wall grows back on the way out;
 * - **interval ends** — drag each independently; the centre stays inside and is
 *   pushed only when an end would cross it;
 * - **wheel over the engaged dot** — centre + resize the interval symmetrically;
 * - **vertical drag past the track height** — the mobile equivalent of the wheel;
 * - **empty track** — tap to place the centre there.
 *
 * The centre and both interval bounds are ARIA sliders, so the whole control is
 * keyboard-operable (arrows move the centre, shift+arrows resize, the bounds
 * nudge with their own arrows).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import IntervalHandle from "../IntervalHandle";
import {
  dragEnd,
  effectiveBounds,
  moveCenter,
  setSymmetricHalf,
  symmetricHalf,
  type GuessValue,
} from "./interval-model";

export type { GuessValue };

export interface WaveSliderProps {
  value: GuessValue;
  onChange: (next: GuessValue) => void;
  min?: number;
  max?: number;
  /** Nudge granularity for arrow keys and pointer snapping. */
  step?: number;
  /** Coarse granularity for PageUp/PageDown. */
  bigStep?: number;
  disabled?: boolean;
  dir?: "ltr" | "rtl";
  /** Accessible name for the centre thumb. */
  label?: string;
}

type DragTarget = "center" | "lower" | "upper";

const WHEEL_STEP = 3;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function hapticTick(center: number, min: number, max: number) {
  const mid = (min + max) / 2;
  if (
    (center === min || center === max || center === mid) &&
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  ) {
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
  const thumbRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  });

  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const grabOffsetRef = useRef(0);

  const { center } = value;
  const { lower, upper } = effectiveBounds(value, min, max);
  const toRatio = (x: number) => (max > min ? (x - min) / (max - min) : 0);
  const toLeft = (x: number) => (dir === "rtl" ? 1 - toRatio(x) : toRatio(x));

  const emit = useCallback(
    (next: GuessValue) => {
      // Keep the ref authoritative *now*, before React re-renders: rapid input
      // (three arrow presses in one tick, a fast wheel) fires several handlers
      // between renders, and each must build on the previous emit — not the
      // stale value from the render that bound it. Without this, quick keypresses
      // collapse into a single step.
      valueRef.current = next;
      hapticTick(next.center, min, max);
      onChangeRef.current(next);
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
      return clamp(Math.round((min + clamp(ratio, 0, 1) * (max - min)) / step) * step, min, max);
    },
    [dir, min, max, step],
  );

  const applyCenterDrag = useCallback(
    (clientX: number, clientY: number) => {
      const track = trackRef.current;
      const v = valueRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (Math.abs(clientY - midY) > rect.height) {
        // Far above/below the track -> the mobile symmetric-resize gesture.
        const overflowPx = Math.abs(clientY - midY) - rect.height;
        const unitsPerPx = rect.width ? (max - min) / rect.width : 0;
        emit(setSymmetricHalf(v, Math.round(overflowPx * unitsPerPx), min, max));
      } else {
        emit(moveCenter(v, positionFromClientX(clientX) + grabOffsetRef.current, min, max));
      }
    },
    [emit, positionFromClientX, min, max],
  );

  const applyEndDrag = useCallback(
    (side: "lower" | "upper", clientX: number) => {
      emit(dragEnd(valueRef.current, side, positionFromClientX(clientX), min, max));
    },
    [emit, positionFromClientX, min, max],
  );

  useEffect(() => {
    if (!dragTarget) return;
    const onMove = (ev: globalThis.PointerEvent) => {
      if (dragTarget === "center") applyCenterDrag(ev.clientX, ev.clientY);
      else applyEndDrag(dragTarget, ev.clientX);
    };
    const onUp = () => setDragTarget(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragTarget, applyCenterDrag, applyEndDrag]);

  // Wheel resizes symmetrically, but only while the dot is engaged (focused),
  // so idle hover never hijacks page scroll. Non-passive to allow preventDefault.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onWheel = (ev: WheelEvent) => {
      if (disabled || document.activeElement !== thumbRef.current) return;
      ev.preventDefault();
      const v = valueRef.current;
      const delta = ev.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP;
      emit(setSymmetricHalf(v, symmetricHalf(v, min, max) + delta, min, max));
    };
    track.addEventListener("wheel", onWheel, { passive: false });
    return () => track.removeEventListener("wheel", onWheel);
  }, [disabled, emit, min, max]);

  function startCenterDrag(ev: PointerEvent<HTMLElement>, jump: boolean) {
    if (disabled) return;
    ev.preventDefault();
    const pointerVal = positionFromClientX(ev.clientX);
    if (jump) {
      grabOffsetRef.current = 0;
      emit(moveCenter(valueRef.current, pointerVal, min, max));
    } else {
      grabOffsetRef.current = valueRef.current.center - pointerVal;
    }
    setDragTarget("center");
  }

  function startEndDrag(side: "lower" | "upper", ev: PointerEvent<HTMLElement>) {
    if (disabled) return;
    ev.preventDefault();
    ev.stopPropagation();
    setDragTarget(side);
  }

  function handleCenterKeyDown(ev: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    // Read the live value, not the render-time closure, so back-to-back presses
    // that arrive before a re-render each build on the previous one.
    const v = valueRef.current;
    const moveTo = (c: number) => emit(moveCenter(v, c, min, max));
    const widen = (d: number) =>
      emit({
        center: v.center,
        widthLeft: Math.max(0, v.widthLeft + d),
        widthRight: Math.max(0, v.widthRight + d),
      });

    let handled = true;
    if (ev.shiftKey) {
      if (ev.key === "ArrowRight" || ev.key === "ArrowUp") widen(step);
      else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") widen(-step);
      else handled = false;
    } else if (ev.key === "ArrowRight" || ev.key === "ArrowUp") moveTo(v.center + step);
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") moveTo(v.center - step);
    else if (ev.key === "PageUp") moveTo(v.center + bigStep);
    else if (ev.key === "PageDown") moveTo(v.center - bigStep);
    else if (ev.key === "Home") moveTo(min);
    else if (ev.key === "End") moveTo(max);
    else handled = false;

    if (handled) ev.preventDefault();
  }

  const nudgeLower = (delta: number) => {
    const v = valueRef.current;
    const b = effectiveBounds(v, min, max);
    emit(dragEnd(v, "lower", b.lower + delta, min, max));
  };
  const nudgeUpper = (delta: number) => {
    const v = valueRef.current;
    const b = effectiveBounds(v, min, max);
    emit(dragEnd(v, "upper", b.upper + delta, min, max));
  };

  return (
    <div className="bsg-slider" data-disabled={disabled || undefined} dir={dir}>
      <div
        ref={trackRef}
        className="bsg-slider-track"
        data-testid="wave-slider-track"
        data-dragging={dragTarget || undefined}
        onPointerDown={(ev) => startCenterDrag(ev, true)}
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
          onPointerDown={(ev) => {
            ev.stopPropagation();
            startCenterDrag(ev, false);
          }}
          style={{
            left: `${Math.min(toLeft(lower), toLeft(upper)) * 100}%`,
            width: `${Math.abs(toLeft(upper) - toLeft(lower)) * 100}%`,
          }}
        />
        <IntervalHandle
          label="Interval lower bound"
          position={lower}
          min={min}
          max={max}
          step={step}
          dir={dir}
          disabled={disabled}
          onNudge={nudgeLower}
          onPointerDown={(ev) => startEndDrag("lower", ev)}
        />
        <IntervalHandle
          label="Interval upper bound"
          position={upper}
          min={min}
          max={max}
          step={step}
          dir={dir}
          disabled={disabled}
          onNudge={nudgeUpper}
          onPointerDown={(ev) => startEndDrag("upper", ev)}
        />
        <div
          ref={thumbRef}
          role="slider"
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={Math.round(center)}
          aria-valuetext={`${Math.round(center)}, interval ${Math.round(lower)} to ${Math.round(upper)}`}
          aria-orientation="horizontal"
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          className="bsg-slider-thumb"
          style={{ left: `${toLeft(center) * 100}%` }}
          onKeyDown={handleCenterKeyDown}
          onPointerDown={(ev) => {
            ev.stopPropagation();
            startCenterDrag(ev, false);
          }}
        />
      </div>
    </div>
  );
}

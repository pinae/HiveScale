/**
 * WaveSlider (WP-08): the one-thumb guess control.
 *
 * A player places a Thing on a 0-100 scale (`center`) and stretches a confidence
 * interval around it. The guess is drawn live as a truncated split-normal bell
 * above the scale (`normal.ts`), so the player sees the distribution they're
 * shaping — and being scored on. All interval maths live in `interval-model.ts`;
 * this file is the thin translation of gestures to those pure calls:
 *
 * - **white dot** — drag horizontally to move the centre (the bell travels with
 *   it); drag *up* to widen the bell, *down* to narrow it;
 * - **σ handles** — two knobs on a sub-rail beneath the scale set each side's
 *   spread independently. Drag one outward along the rail to grow σ; once it
 *   reaches the wall it hangs *down* a wall-drop, and dragging further down keeps
 *   growing σ past the scale edge (a wide, flat truncated bell) — no horizontal
 *   scroll. At σ→0 they park either side of the dot so they never hide behind it;
 * - **wheel over the engaged dot** — up widens, down narrows;
 * - **empty track** — tap to place the centre there.
 *
 * The centre and both σ handles are ARIA sliders, so the whole control is
 * keyboard-operable (arrows move the centre, shift+arrows resize both sides, each
 * σ handle's arrows grow/shrink that side's spread — off the scale too).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import IntervalHandle from "../IntervalHandle";
import {
  effectiveBounds,
  handlePlacement,
  moveCenter,
  resizeSpread,
  setSigma,
  setSpread,
  sigmaCap,
  type GuessValue,
} from "./interval-model";
import { bellGeometry } from "./normal";

export type { GuessValue };

//: The bell is drawn in this viewBox and stretched to the track width.
const CURVE_VW = 1000;
const CURVE_VH = 260;

//: Sub-rail geometry. Handles ride a rail this many px below the track; past the
//: wall they hang down up to RAIL_DROP_PX (kept in sync with the CSS variables).
const RAIL_OFFSET_PX = 14;

//: A σ handle is never drawn closer than this fraction of the track to the
//: centre, so at σ→0 the two handles stay visible either side of the dot.
const HANDLE_MIN_GAP = 0.05;

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
  // Captured when a centre drag begins: the pointer Y and the widths at that
  // moment, so the vertical resize is relative to where the grab started (no
  // jump on grab) and directional (up widens, down narrows).
  const dragBaseRef = useRef({ y: 0, widthLeft: 0, widthRight: 0 });

  const { center } = value;
  const { lower, upper } = effectiveBounds(value, min, max);
  const toRatio = (x: number) => (max > min ? (x - min) / (max - min) : 0);
  const toLeft = (x: number) => (dir === "rtl" ? 1 - toRatio(x) : toRatio(x));

  const cap = sigmaCap(min, max);
  const centerFrac = toLeft(center);
  const leftPlacement = handlePlacement("lower", center, value.widthLeft, min, max);
  const rightPlacement = handlePlacement("upper", center, value.widthRight, min, max);
  // Screen fraction with RTL mirroring and a min-gap so a small-σ handle never
  // hides under the dot (or the other handle).
  const handleFraction = (side: "lower" | "upper", frac: number, offScale: boolean) => {
    let f = dir === "rtl" ? 1 - frac : frac;
    if (!offScale) {
      const onLeft = (side === "lower") !== (dir === "rtl");
      f = onLeft ? Math.min(f, centerFrac - HANDLE_MIN_GAP) : Math.max(f, centerFrac + HANDLE_MIN_GAP);
    }
    return clamp(f, 0, 1);
  };

  const gradientId = useId();
  const bell = useMemo(
    () => bellGeometry(value, min, max, CURVE_VW, CURVE_VH, dir),
    [value, min, max, dir],
  );

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

      // Horizontal movement repositions the centre (widths ride along).
      const moved = moveCenter(v, positionFromClientX(clientX) + grabOffsetRef.current, min, max);

      // Vertical movement past a small dead-zone reshapes the bell: up widens,
      // down narrows, relative to where the grab started so there's no jump.
      const base = dragBaseRef.current;
      const dy = base.y - clientY; // up is positive
      const past = Math.sign(dy) * Math.max(0, Math.abs(dy) - rect.height);
      const unitsPerPx = rect.width ? (max - min) / rect.width : 0;
      const delta = past * unitsPerPx;

      emit(setSpread(moved, base.widthLeft + delta, base.widthRight + delta, min, max));
    },
    [emit, positionFromClientX, min, max],
  );

  // Continuous scale value from a pointer X, NOT clamped to [min, max] — a σ
  // handle needs to know when the pointer has passed the wall.
  const rawValueFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return valueRef.current.center;
      const rect = track.getBoundingClientRect();
      let ratio = rect.width ? (clientX - rect.left) / rect.width : 0;
      if (dir === "rtl") ratio = 1 - ratio;
      return min + ratio * (max - min);
    },
    [dir, min, max],
  );

  // Drag a σ handle: horizontal distance from the centre sets σ up to the wall;
  // once at the wall, dragging *down* the wall-rail pushes σ past it. So σ can
  // grow beyond the scale using vertical space, never horizontal scroll.
  const applySigmaDrag = useCallback(
    (side: "lower" | "upper", clientX: number, clientY: number) => {
      const track = trackRef.current;
      const v = valueRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const pointerValue = rawValueFromClientX(clientX);
      const wall = side === "lower" ? v.center - min : max - v.center;
      const horizontal = side === "lower" ? v.center - pointerValue : pointerValue - v.center;

      let sigma = clamp(horizontal, 0, wall);
      if (horizontal >= wall - 1e-6) {
        // At (or past) the wall — the extra spread comes from the downward drag.
        const cornerY = rect.bottom + RAIL_OFFSET_PX;
        const dropPx = Math.max(0, clientY - cornerY);
        const unitsPerPx = rect.width ? (max - min) / rect.width : 0;
        sigma = wall + dropPx * unitsPerPx;
      }
      sigma = Math.round(sigma / step) * step;
      emit(setSigma(v, side, sigma, min, max));
    },
    [emit, rawValueFromClientX, min, max, step],
  );

  useEffect(() => {
    if (!dragTarget) return;
    const onMove = (ev: globalThis.PointerEvent) => {
      if (dragTarget === "center") applyCenterDrag(ev.clientX, ev.clientY);
      else applySigmaDrag(dragTarget, ev.clientX, ev.clientY);
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
  }, [dragTarget, applyCenterDrag, applySigmaDrag]);

  // Wheel resizes the spread, but only while the dot is engaged (focused), so
  // idle hover never hijacks page scroll. Up widens, down narrows. Non-passive
  // to allow preventDefault.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onWheel = (ev: WheelEvent) => {
      if (disabled || document.activeElement !== thumbRef.current) return;
      ev.preventDefault();
      const delta = ev.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP;
      emit(resizeSpread(valueRef.current, delta, min, max));
    };
    track.addEventListener("wheel", onWheel, { passive: false });
    return () => track.removeEventListener("wheel", onWheel);
  }, [disabled, emit, min, max]);

  function startCenterDrag(ev: PointerEvent<HTMLElement>, jump: boolean) {
    if (disabled) return;
    ev.preventDefault();
    const pointerVal = positionFromClientX(ev.clientX);
    // Snapshot the widths + grab Y so the vertical resize is relative (no jump).
    const v = valueRef.current;
    dragBaseRef.current = { y: ev.clientY, widthLeft: v.widthLeft, widthRight: v.widthRight };
    if (jump) {
      grabOffsetRef.current = 0;
      emit(moveCenter(v, pointerVal, min, max));
    } else {
      grabOffsetRef.current = v.center - pointerVal;
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
    const widen = (d: number) => emit(resizeSpread(v, d, min, max));

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

  // A σ handle's arrows grow/shrink that side's spread directly (past the wall
  // too), so the whole control — including off-scale spread — is keyboard-usable.
  const nudgeLeftSigma = (delta: number) =>
    emit(setSigma(valueRef.current, "lower", valueRef.current.widthLeft + delta, min, max));
  const nudgeRightSigma = (delta: number) =>
    emit(setSigma(valueRef.current, "upper", valueRef.current.widthRight + delta, min, max));

  return (
    <div className="bsg-slider" data-disabled={disabled || undefined} dir={dir}>
      <svg
        className="bsg-slider-curve"
        data-testid="wave-slider-curve"
        viewBox={`0 0 ${CURVE_VW} ${CURVE_VH}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--bsg-wave)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--bsg-wave)" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <line
          className="bsg-slider-bell-guide"
          x1={toLeft(lower) * CURVE_VW}
          y1="0"
          x2={toLeft(lower) * CURVE_VW}
          y2={CURVE_VH}
        />
        <line
          className="bsg-slider-bell-guide"
          x1={toLeft(upper) * CURVE_VW}
          y1="0"
          x2={toLeft(upper) * CURVE_VW}
          y2={CURVE_VH}
        />
        <path className="bsg-slider-bell-fill" d={bell.area} fill={`url(#${gradientId})`} />
        <path className="bsg-slider-bell-line" d={bell.line} />
        <line
          className="bsg-slider-bell-peak"
          x1={bell.peakX}
          y1="0"
          x2={bell.peakX}
          y2={CURVE_VH}
        />
      </svg>
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
        {/* Sub-rail the σ handles ride, with a wall-drop hanging below each end
            so a handle pushed past the scale has somewhere to go (down, not off
            the side). */}
        <div className="bsg-slider-subrail" aria-hidden="true" />
        <div
          className="bsg-slider-walldrop"
          aria-hidden="true"
          style={{ left: `${toLeft(min) * 100}%` }}
        />
        <div
          className="bsg-slider-walldrop"
          aria-hidden="true"
          style={{ left: `${toLeft(max) * 100}%` }}
        />
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
          label="Left spread"
          sigma={value.widthLeft}
          sigmaMax={cap}
          leftFraction={handleFraction("lower", leftPlacement.frac, leftPlacement.offScale)}
          drop={leftPlacement.drop}
          offScale={leftPlacement.offScale}
          step={step}
          disabled={disabled}
          onNudge={nudgeLeftSigma}
          onPointerDown={(ev) => startEndDrag("lower", ev)}
        />
        <IntervalHandle
          label="Right spread"
          sigma={value.widthRight}
          sigmaMax={cap}
          leftFraction={handleFraction("upper", rightPlacement.frac, rightPlacement.offScale)}
          drop={rightPlacement.drop}
          offScale={rightPlacement.offScale}
          step={step}
          disabled={disabled}
          onNudge={nudgeRightSigma}
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

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

//: Sub-rail geometry (kept in sync with the CSS variables). Handles ride a rail
//: RAIL_OFFSET_PX below the track; its ends bend down through a RAIL_CORNER_PX-tall
//: rounded elbow (horizontal radius CORNER_FRAC of the track width), then a
//: handle pushed past the wall hangs straight down up to RAIL_DROP_PX further.
const RAIL_OFFSET_PX = 5;
const RAIL_CORNER_PX = 40;
const RAIL_DROP_PX = 80;
const CORNER_FRAC = 0.12;
//: Track and diagram heights (--bsg-thumb-size / .bsg-slider-curve), for placing
//: the σ guides that run from the top of the bell down to each handle.
const TRACK_PX = 32;
const CURVE_PX = 92;
//: Handle half-size (.bsg-interval-handle is 16×22), so a guide can end on the
//: handle's pointy top corner.
const HANDLE_HALF_W = 8;
const HANDLE_HALF_H = 11;
//: Over this much of the guide's tail it beziers across to the pointy corner.
const GUIDE_BEND_PX = 16;
//: A σ drag within this many px of the bent rail snaps onto it; farther out the
//: pointer's plain horizontal position is used instead.
const SIGMA_SNAP_PX = 12;

//: A σ handle is never drawn closer than this fraction of the track to the
//: centre, so at σ→0 the two handles stay visible either side of the dot.
const HANDLE_MIN_GAP = 0.05;

interface RailGeometry {
  /** Screen fraction (0…1) of the handle's centre across the track. */
  handleFrac: number;
  /** Screen fraction of the bell's ±1σ mark (ungapped), where the guide starts. */
  markFrac: number;
  /** How far (px) below the rail's top edge the handle hangs. */
  dropPx: number;
  offScale: boolean;
}

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
  // Measured track width, so the σ guides can be drawn in px (one path from the
  // bell down to each handle) rather than mismatched percentage/px coordinates.
  const [trackWidth, setTrackWidth] = useState(0);
  const grabOffsetRef = useRef(0);
  // Captured when a centre drag begins: the pointer Y and the widths at that
  // moment, so the vertical resize is relative to where the grab started (no
  // jump on grab) and directional (up widens, down narrows).
  const dragBaseRef = useRef({ y: 0, widthLeft: 0, widthRight: 0 });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => setTrackWidth(track.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, []);

  const { center } = value;
  const { lower, upper } = effectiveBounds(value, min, max);
  const toRatio = (x: number) => (max > min ? (x - min) / (max - min) : 0);
  const toLeft = (x: number) => (dir === "rtl" ? 1 - toRatio(x) : toRatio(x));

  const cap = sigmaCap(min, max);
  const centerFrac = toLeft(center);
  // The visual side a handle sits on (accounting for RTL), so its top corner
  // nearest the scale is squared off into a drop pointing at its σ guide.
  const handlePointSide = (side: "lower" | "upper"): "left" | "right" =>
    (side === "lower") !== (dir === "rtl") ? "left" : "right";

  // Where a handle sits and how far it hangs, so both the knob and its guide land
  // on the rail's bent shape: flat along the top, down the rounded elbow as σ
  // nears the wall, then straight down the drop past it.
  const railGeometry = (side: "lower" | "upper", sigma: number): RailGeometry => {
    const bound = side === "upper" ? center + sigma : center - sigma;
    const ratio = max > min ? (bound - min) / (max - min) : 0;
    const sf = dir === "rtl" ? 1 - ratio : ratio; // unclamped screen fraction
    const offScale = sf < 0 || sf > 1;
    const markFrac = clamp(sf, 0, 1);

    let handleFrac = markFrac;
    if (!offScale) {
      const onLeft = (side === "lower") !== (dir === "rtl");
      handleFrac = onLeft
        ? Math.min(handleFrac, centerFrac - HANDLE_MIN_GAP)
        : Math.max(handleFrac, centerFrac + HANDLE_MIN_GAP);
      handleFrac = clamp(handleFrac, 0, 1);
    }

    let dropPx = 0;
    if (offScale) {
      const wall = side === "upper" ? max - center : center - min;
      const over = clamp((sigma - wall) / Math.max(1, cap - wall), 0, 1);
      dropPx = RAIL_CORNER_PX + over * RAIL_DROP_PX;
    } else {
      const edge = Math.min(handleFrac, 1 - handleFrac);
      if (edge < CORNER_FRAC) {
        // On the quarter-ellipse elbow: cos runs -1 (at the wall) → 0 where it starts.
        const cos = edge / CORNER_FRAC - 1;
        dropPx = RAIL_CORNER_PX * (1 - Math.sqrt(1 - cos * cos));
      }
    }
    return { handleFrac, markFrac, dropPx, offScale };
  };

  const leftGeom = railGeometry("lower", value.widthLeft);
  const rightGeom = railGeometry("upper", value.widthRight);

  // One dashed path per side from the bell's ±1σ mark down to the handle's pointy
  // corner: straight until the tail, where it beziers across to that corner. Drawn
  // in track-space px (needs the measured width), so it is a single connected line.
  const guidePath = (geom: RailGeometry, pointSide: "left" | "right"): string => {
    if (!trackWidth) return "";
    const markX = geom.markFrac * trackWidth;
    const handleX = geom.handleFrac * trackWidth;
    const topY = TRACK_PX + RAIL_OFFSET_PX + geom.dropPx - HANDLE_HALF_H;
    const tipX = handleX + (pointSide === "left" ? HANDLE_HALF_W : -HANDLE_HALF_W);
    return `M ${markX} ${-CURVE_PX} L ${markX} ${topY - GUIDE_BEND_PX} Q ${markX} ${topY} ${tipX} ${topY}`;
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

  // Drag a σ handle by projecting the pointer onto the bent rail — the five
  // segments the handle can ride: the flat top, the two rounded elbows, and the
  // two straight wall-drops. On the flat the pointer's horizontal position sets
  // σ; on an elbow σ comes from the pointer's *angle* about the elbow's centre
  // (so it follows the curve); below an elbow the downward distance pushes σ past
  // the wall. A pointer more than SIGMA_SNAP_PX from the elbow falls back to the
  // plain horizontal position, and below the elbow's centre — where the angle
  // would invert — the drop takes over. So σ can grow beyond the scale using
  // vertical space, never horizontal scroll.
  const applySigmaDrag = useCallback(
    (side: "lower" | "upper", clientX: number, clientY: number) => {
      const track = trackRef.current;
      const v = valueRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const width = rect.width || 1;
      const upper = side === "upper";
      const onRight = upper !== (dir === "rtl"); // which screen edge this handle rides
      const rx = CORNER_FRAC * width;
      const railTopY = rect.bottom + RAIL_OFFSET_PX;
      const elbowY = railTopY + RAIL_CORNER_PX; // elbow foot = arc centre's y
      const elbowX = onRight ? rect.right - rx : rect.left + rx; // arc centre x
      const wall = upper ? max - v.center : v.center - min;
      const capOverflow = Math.max(1, sigmaCap(min, max) - wall);

      const valueAt = (x: number) => {
        let ratio = (x - rect.left) / width;
        if (dir === "rtl") ratio = 1 - ratio;
        return min + ratio * (max - min);
      };
      const horizontalSigma = () =>
        clamp(upper ? valueAt(clientX) - v.center : v.center - valueAt(clientX), 0, wall);

      const pastElbow = onRight ? clientX >= elbowX : clientX <= elbowX;
      let sigma: number;
      if (!pastElbow || clientY <= railTopY) {
        // Over the flat top (or not yet at the elbow): horizontal position sets σ.
        sigma = horizontalSigma();
      } else if (clientY <= elbowY) {
        // Beside the elbow, above its centre: project onto the arc by angle.
        const dx = Math.abs(clientX - elbowX);
        const dy = elbowY - clientY; // ≥ 0 above the centre
        const phi = clamp(Math.atan2(dx, dy), 0, Math.PI / 2);
        const arcX = onRight ? elbowX + rx * Math.sin(phi) : elbowX - rx * Math.sin(phi);
        const arcY = elbowY - RAIL_CORNER_PX * Math.cos(phi);
        sigma =
          Math.hypot(clientX - arcX, clientY - arcY) > SIGMA_SNAP_PX
            ? horizontalSigma() // too far from the bend — track the horizontal instead
            : clamp(upper ? valueAt(arcX) - v.center : v.center - valueAt(arcX), 0, wall);
      } else {
        // Below the elbow: the straight wall-drop pushes σ past the wall.
        const dropPx = clamp(clientY - elbowY, 0, RAIL_DROP_PX);
        sigma = wall + (dropPx / RAIL_DROP_PX) * capOverflow;
      }
      sigma = Math.round(sigma / step) * step;
      emit(setSigma(v, side, sigma, min, max));
    },
    [emit, dir, min, max, step],
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
        {/* Sub-rail the σ handles ride: a horizontal line whose ends bend down
            through a rounded elbow into wall-drops, so a handle pushed past the
            scale has somewhere to go (down, not off the side). */}
        <div className="bsg-slider-subrail" aria-hidden="true" />
        {/* The bell's ±1σ guides as one dashed line each, running from the top of
            the diagram down to the handle's pointy corner (straight, then a short
            bezier onto the corner). Track-space px, no viewBox; overflows up over
            the bell (which paints above it) and down past the track to the drop. */}
        <svg className="bsg-slider-guides" aria-hidden="true">
          <path className="bsg-slider-bell-guide" d={guidePath(leftGeom, handlePointSide("lower"))} />
          <path className="bsg-slider-bell-guide" d={guidePath(rightGeom, handlePointSide("upper"))} />
        </svg>
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
          leftFraction={leftGeom.handleFrac}
          dropPx={leftGeom.dropPx}
          offScale={leftGeom.offScale}
          pointSide={handlePointSide("lower")}
          step={step}
          disabled={disabled}
          onNudge={nudgeLeftSigma}
          onPointerDown={(ev) => startEndDrag("lower", ev)}
        />
        <IntervalHandle
          label="Right spread"
          sigma={value.widthRight}
          sigmaMax={cap}
          leftFraction={rightGeom.handleFrac}
          dropPx={rightGeom.dropPx}
          offScale={rightGeom.offScale}
          pointSide={handlePointSide("upper")}
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

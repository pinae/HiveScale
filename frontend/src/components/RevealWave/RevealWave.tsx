/**
 * RevealWave (WP-09): the reveal — the emotional payoff of a round (plan §2.1).
 *
 * The crowd histogram rises under the player's marker, their interval glows
 * where it overlaps the crowd mass, the score counts up with a percentile
 * stinger and an outcome quip, split crowds are celebrated, and an optional
 * "beat the bot" overlay compares the player to the AI. Pioneer rounds show the
 * flat bonus and a clearly-labelled provisional AI estimate instead of a crowd.
 *
 * Everything is driven by the POST /api/round/guess/ payload plus the guess the
 * player just made, so designers can browse every variant without a backend.
 */
import { useEffect, useState } from "react";

import type { AiEstimate, RevealPayload } from "../../api/reveal";
import ScorePanel from "../ScorePanel";
import { splitNormalMasses } from "../WaveSlider/normal";
import { beatMargin, classifyOutcome, pickQuip } from "./reveal-outcome";
import { histogramCurve } from "./curves";
import type { GuessValue } from "../WaveSlider";

const CHART_VW = 1000;
const CHART_VH = 100;

export interface RevealWaveProps {
  reveal: RevealPayload;
  /** The guess the player just submitted (drives the marker + interval). */
  guess: GuessValue;
  /** Optional AI prior for the "beat the bot" overlay on a human reveal. */
  aiEstimate?: AiEstimate | null;
  /** Defaults to true; also suppressed under prefers-reduced-motion. */
  animate?: boolean;
  /** Deterministic quip selection for stories/tests. */
  quipSeed?: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

function HistogramChart({
  histogram,
  belief,
  guess,
  aiMedian,
  label,
}: {
  histogram: number[];
  /** The crowd's summed beliefs, drawn as the orange curve. Empty = skip it. */
  belief?: number[];
  guess: GuessValue;
  aiMedian?: number;
  label: string;
}) {
  const max = Math.max(...histogram, 1e-9);
  const lower = clamp(guess.center - guess.widthLeft, 0, 100);
  const upper = clamp(guess.center + guess.widthRight, 0, 100);
  // The player's guess as its truncated split-normal *bucket masses* (sum→1) —
  // the same quantity, buckets and normalization as the crowd's belief histogram,
  // so the two curves coincide when the guess matches (what belief_match scores).
  // Peak-normalizing the bell instead (its own separate scale) is why they used
  // to sit apart even for an accurate, bell-shaped guess.
  const guessMasses = splitNormalMasses(guess.center, guess.widthLeft, guess.widthRight, histogram.length);
  // Both smooth curves share one vertical scale so equal masses draw at equal
  // heights; the taller of belief/guess just reaches the top.
  const curveMax = Math.max(...(belief ?? []), ...guessMasses, 1e-9);
  const guessCurve = histogramCurve(guessMasses, CHART_VW, CHART_VH, curveMax);
  const beliefCurve =
    belief && belief.length ? histogramCurve(belief, CHART_VW, CHART_VH, curveMax) : null;
  return (
    <div className="bsg-reveal-chart" role="img" aria-label={label}>
      <div className="bsg-reveal-bars">
        {histogram.map((weight, i) => {
          const bucketCenter = (i + 0.5) * 5;
          const covered = bucketCenter >= lower && bucketCenter <= upper;
          return (
            <div
              key={i}
              data-testid="reveal-hist-bar"
              className="bsg-reveal-bar"
              data-covered={covered || undefined}
              style={{ height: `${(weight / max) * 100}%` }}
            />
          );
        })}
      </div>
      <svg
        className="bsg-reveal-overlay"
        data-testid="reveal-overlay"
        viewBox={`0 0 ${CHART_VW} ${CHART_VH}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {beliefCurve ? (
          <>
            <path className="bsg-reveal-belief-fill" d={beliefCurve.area} />
            <path className="bsg-reveal-belief-line" d={beliefCurve.line} />
          </>
        ) : null}
        <path className="bsg-reveal-guess-fill" d={guessCurve.area} />
        <path className="bsg-reveal-guess-line" d={guessCurve.line} />
      </svg>
      {aiMedian !== undefined ? (
        <div className="bsg-reveal-ai-marker" style={{ left: `${aiMedian}%` }} aria-hidden="true" />
      ) : null}
      <div className="bsg-reveal-marker" style={{ left: `${guess.center}%` }} aria-hidden="true" />
    </div>
  );
}

export default function RevealWave({
  reveal,
  guess,
  aiEstimate = null,
  animate = true,
  quipSeed = 0,
}: RevealWaveProps) {
  const reducedMotion = usePrefersReducedMotion();
  const active = animate && !reducedMotion;

  return (
    <section
      className="bsg-reveal"
      role="region"
      aria-label="Round reveal"
      data-animated={active}
      data-source={reveal.source}
    >
      {reveal.source === "human"
        ? renderHuman(reveal, guess, aiEstimate, active, quipSeed)
        : renderPioneer(reveal, guess, quipSeed)}
    </section>
  );
}

function renderHuman(
  reveal: Extract<RevealPayload, { source: "human" }>,
  guess: GuessValue,
  aiEstimate: AiEstimate | null,
  active: boolean,
  quipSeed: number,
) {
  const outcome = classifyOutcome(reveal.crowd.median, guess);
  const margin = aiEstimate ? beatMargin(reveal.crowd.median, guess.center, aiEstimate.median) : 0;
  return (
    <>
      {reveal.bimodal ? (
        <p className="bsg-reveal-banner" data-variant="bimodal">
          ⚔️ Society is at war over this one!
        </p>
      ) : null}
      <HistogramChart
        histogram={reveal.crowd.histogram}
        belief={reveal.crowd.belief_histogram}
        guess={guess}
        aiMedian={aiEstimate ? aiEstimate.median : undefined}
        label="Crowd distribution with your guess"
      />
      <ScorePanel
        score={reveal.score}
        percentile={reveal.percentile}
        outcome={outcome}
        quip={pickQuip(outcome, quipSeed)}
        animate={active}
        streakHot={reveal.streak.hot}
        multiplier={reveal.player.multiplier}
      />
      {aiEstimate ? (
        <p className="bsg-reveal-beatbot" data-win={margin >= 0 || undefined}>
          {margin > 0
            ? `You beat Gemini by ${margin} points on this one.`
            : margin < 0
              ? `Gemini edged you by ${-margin} points here.`
              : "Dead heat with Gemini."}
        </p>
      ) : null}
      {reveal.counted ? null : (
        <p className="bsg-reveal-note">Too quick to count — a peek, but no points banked.</p>
      )}
    </>
  );
}

function renderPioneer(
  reveal: Extract<RevealPayload, { source: "pioneer" }>,
  guess: GuessValue,
  quipSeed: number,
) {
  const ai = reveal.ai_estimate;
  return (
    <>
      <p className="bsg-reveal-banner" data-variant="pioneer">
        🚩 Pioneer round
      </p>
      {ai ? (
        <>
          <p className="bsg-reveal-ai-label">AI estimate — be one of the first humans to weigh in!</p>
          <HistogramChart
            histogram={ai.histogram}
            guess={guess}
            aiMedian={ai.median}
            label="Provisional AI estimate with your guess"
          />
        </>
      ) : (
        <p className="bsg-reveal-ai-label">No crowd yet — you&apos;re charting this one.</p>
      )}
      <p className="bsg-score-quip">{pickQuip("pioneer", quipSeed)}</p>
      <output
        className="bsg-score-total"
        data-testid="reveal-score-total"
        aria-label="Pioneer bonus"
      >
        {reveal.pioneer_bonus}
      </output>
      <p className="bsg-reveal-note">Pioneer bonus banked.</p>
      {reveal.counted ? null : (
        <p className="bsg-reveal-note">Too quick to count — no bonus banked.</p>
      )}
    </>
  );
}

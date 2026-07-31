/**
 * The score panel of the reveal (WP-09): an outcome quip, the count-up total,
 * its means-match / belief-match breakdown, and the percentile stinger.
 */
import { useEffect, useState } from "react";

import type { ScoreBreakdown } from "../../api/reveal";
import type { OutcomeClass } from "../RevealWave/reveal-outcome";

export interface ScorePanelProps {
  score: ScoreBreakdown;
  percentile: number;
  outcome: OutcomeClass;
  quip: string;
  animate: boolean;
  streakHot?: number;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Animate a number from 0 to `target`; jump straight to it when inactive. */
function useCountUp(target: number, active: boolean): number {
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    const duration = 750;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setAnimated(Math.round(target * easeOut(t)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active]);
  // When not animating, the value is simply the target — computed in render,
  // never set into state from the effect.
  return active ? animated : target;
}

export default function ScorePanel({
  score,
  percentile,
  outcome,
  quip,
  animate,
  streakHot = 0,
}: ScorePanelProps) {
  const total = useCountUp(Math.round(score.total), animate);

  return (
    <div className="bsg-score-panel" data-outcome={outcome}>
      <p className="bsg-score-quip">{quip}</p>
      <output className="bsg-score-total" data-testid="reveal-score-total" aria-label="Round score">
        {total}
      </output>
      <dl className="bsg-score-breakdown">
        <div>
          <dt>Means match</dt>
          <dd>{Math.round(score.means_match * 100)}%</dd>
        </div>
        <div>
          <dt>Belief match</dt>
          <dd>{Math.round(score.belief_match * 100)}%</dd>
        </div>
      </dl>
      <p className="bsg-score-percentile">
        Closer to the hive mind than <strong>{Math.round(percentile)}%</strong> of players.
      </p>
      {streakHot >= 3 ? (
        <p className="bsg-score-streak" aria-label={`Hot streak: ${streakHot}`}>
          🔥 {streakHot} in a row
        </p>
      ) : null}
    </div>
  );
}

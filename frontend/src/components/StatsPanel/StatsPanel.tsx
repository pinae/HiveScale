/**
 * The stats / archetype page (WP-11, plan §2.2): your calibration identity plus
 * the numbers behind it. Presentational — the caller supplies the stats.
 */
import type { Stats } from "../../api/client";

export interface StatsPanelProps {
  stats: Stats;
}

export default function StatsPanel({ stats }: StatsPanelProps) {
  const { archetype, calibration, streaks, xp, level } = stats;
  return (
    <section className="bsg-stats" role="region" aria-label="Your stats">
      <div className="bsg-stats-archetype">
        <p className="bsg-stats-archetype-name" data-testid="archetype-name">
          {archetype.name}
        </p>
        <p className="bsg-stats-archetype-blurb">{archetype.blurb}</p>
      </div>

      <dl className="bsg-stats-grid">
        <div>
          <dt>Level</dt>
          <dd>{level}</dd>
        </div>
        <div>
          <dt>XP</dt>
          <dd>{xp}</dd>
        </div>
        <div>
          <dt>Daily streak</dt>
          <dd>🔥 {streaks.daily}</dd>
        </div>
        <div>
          <dt>Freezes</dt>
          <dd>🧊 {streaks.freezes}</dd>
        </div>
        <div>
          <dt>Crowd coverage</dt>
          <dd data-testid="stats-coverage">{Math.round(calibration.hit_rate * 100)}%</dd>
        </div>
        <div>
          <dt>Avg interval</dt>
          <dd>{Math.round(calibration.mean_width)}</dd>
        </div>
      </dl>

      {calibration.n === 0 ? (
        <p className="bsg-stats-empty">Play a few rounds to build your calibration profile.</p>
      ) : (
        <p className="bsg-stats-count">Over {calibration.n} scored rounds.</p>
      )}
    </section>
  );
}

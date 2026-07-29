/**
 * The persistent top bar for the game loop (WP-10): brand, running xp/level, and
 * the in-session hot-streak flame.
 */
import type { LevelProgress } from "../../api/reveal";
import logoUrl from "../../hivescale-logo.svg";

export interface SessionHeaderProps {
  xp: number;
  level: number;
  streak: number;
  /** Calibration XP multiplier (×1 hides the chip). */
  multiplier?: number;
  /** Position within the current level, for the progress bar. */
  progress?: LevelProgress | null;
  /** When provided, renders a button that opens the stats page. */
  onShowStats?: () => void;
  /** When provided, renders a button that opens the Daily Wave (WP-11). */
  onDailyWave?: () => void;
  /** When provided (level 5+ unlock), renders the pairing-vote entry. */
  onVote?: () => void;
  /** When provided and the session isn't claimed, offers to save progress. */
  onClaim?: () => void;
  /** Whether the session is already tied to an account (WP-11). */
  isClaimed?: boolean;
}

export default function SessionHeader({
  xp,
  level,
  streak,
  multiplier = 1,
  progress = null,
  onShowStats,
  onDailyWave,
  onVote,
  onClaim,
  isClaimed = false,
}: SessionHeaderProps) {
  const pct =
    progress && progress.level_span > 0
      ? Math.max(0, Math.min(100, (progress.into_level / progress.level_span) * 100))
      : 0;
  return (
    <header className="bsg-session-header">
      <div className="bsg-session-brand">
        <img className="bsg-logo" src={logoUrl} alt="" width={30} height={30} />
        <h1 className="bsg-session-title">HiveScale</h1>
      </div>
      <dl className="bsg-session-stats">
        <div>
          <dt>Level</dt>
          <dd data-testid="session-level">{level}</dd>
        </div>
        <div>
          <dt>XP</dt>
          <dd data-testid="session-xp">{xp}</dd>
        </div>
        {multiplier > 1 ? (
          <div className="bsg-session-mult" aria-label={`XP multiplier ${multiplier} times`}>
            <dt aria-hidden="true">Mult</dt>
            <dd data-testid="session-multiplier">×{multiplier}</dd>
          </div>
        ) : null}
        {streak >= 3 ? (
          <div className="bsg-session-streak" aria-label={`Hot streak: ${streak}`}>
            <dt aria-hidden="true">Streak</dt>
            <dd>🔥 {streak}</dd>
          </div>
        ) : null}
      </dl>
      <div className="bsg-session-actions">
        {isClaimed ? (
          <span className="bsg-session-saved" data-testid="session-saved">
            ✓ Saved
          </span>
        ) : onClaim ? (
          <button type="button" className="bsg-btn bsg-session-claimbtn" onClick={onClaim}>
            Save progress
          </button>
        ) : null}
        {onDailyWave ? (
          <button type="button" className="bsg-btn bsg-session-wavebtn" onClick={onDailyWave}>
            🌊 Daily
          </button>
        ) : null}
        {onVote ? (
          <button type="button" className="bsg-btn bsg-session-votebtn" onClick={onVote}>
            🗳️ Vote
          </button>
        ) : null}
        {onShowStats ? (
          <button type="button" className="bsg-btn bsg-session-statsbtn" onClick={onShowStats}>
            Stats
          </button>
        ) : null}
      </div>
      {progress ? (
        <div
          className="bsg-session-progress"
          data-testid="session-progress"
          role="progressbar"
          aria-label={`Progress to level ${level + 1}`}
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="bsg-session-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </header>
  );
}

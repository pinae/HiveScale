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
  /** When provided (level 4+ unlock), renders the PvP battle entry. */
  onBattle?: () => void;
  /** When provided (level 5+ unlock), renders the pairing-vote entry. */
  onVote?: () => void;
  /** When provided (level 10+ unlock), renders the thing-challenge entry. */
  onChallenge?: () => void;
  /** When provided (level 15+ unlock), renders the scale-request entry. */
  onScaleRequest?: () => void;
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
  onBattle,
  onVote,
  onChallenge,
  onScaleRequest,
  onClaim,
  isClaimed = false,
}: SessionHeaderProps) {
  const pct =
    progress && progress.level_span > 0
      ? Math.max(0, Math.min(100, (progress.into_level / progress.level_span) * 100))
      : 0;
  const hasActions = Boolean(
    onDailyWave || onBattle || onVote || onChallenge || onScaleRequest || onShowStats,
  );
  return (
    <header className="bsg-session-header">
      {/* Top line: brand floats left, the level/xp/multiplier stat trio is
          centred, and the account status floats right. flex-wrap means that if
          it can't all fit it drops onto a second line rather than scrolling. */}
      <div className="bsg-session-top">
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
          {/* Two related-but-distinct stats: the streak is *how many* calibrated
              guesses you've strung together; the multiplier is the *XP reward*
              that run earns (capped ×10). Titles spell the relationship out. */}
          {streak >= 3 ? (
            <div
              className="bsg-session-streak"
              aria-label={`Hot streak: ${streak}`}
              title="Calibrated guesses in a row. Keeping it going is what raises your XP boost."
            >
              <dt aria-hidden="true">Streak</dt>
              <dd>🔥 {streak}</dd>
            </div>
          ) : null}
          {multiplier > 1 ? (
            <div
              className="bsg-session-mult"
              aria-label={`XP multiplier ${multiplier} times`}
              title={`Your XP is multiplied ×${multiplier} right now. It climbs one step for each calibrated guess in a row (up to ×10) and resets on a miss.`}
            >
              <dt aria-hidden="true">XP boost</dt>
              <dd data-testid="session-multiplier">×{multiplier}</dd>
            </div>
          ) : null}
        </dl>
        <div className="bsg-session-account">
          {isClaimed ? (
            <div className="bsg-session-stat">
              <span className="bsg-session-stat-dt">Account</span>
              <span className="bsg-session-saved" data-testid="session-saved">
                ✓ Saved
              </span>
            </div>
          ) : onClaim ? (
            <button type="button" className="bsg-btn bsg-session-claimbtn" onClick={onClaim}>
              Save progress
            </button>
          ) : null}
        </div>
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

      {/* Feature nav sits below the XP bar and wraps, so it never widens the bar. */}
      {hasActions ? (
        <nav className="bsg-session-actions" aria-label="Game features">
          {onDailyWave ? (
            <button type="button" className="bsg-btn bsg-session-wavebtn" onClick={onDailyWave}>
              🌊 Daily
            </button>
          ) : null}
          {onBattle ? (
            <button type="button" className="bsg-btn bsg-session-battlebtn" onClick={onBattle}>
              ⚔️ Battle
            </button>
          ) : null}
          {onVote ? (
            <button type="button" className="bsg-btn bsg-session-votebtn" onClick={onVote}>
              🗳️ Vote
            </button>
          ) : null}
          {onChallenge ? (
            <button type="button" className="bsg-btn bsg-session-challengebtn" onClick={onChallenge}>
              🧩 Challenge
            </button>
          ) : null}
          {onScaleRequest ? (
            <button type="button" className="bsg-btn bsg-session-scalebtn" onClick={onScaleRequest}>
              📐 Scale
            </button>
          ) : null}
          {onShowStats ? (
            <button type="button" className="bsg-btn bsg-session-statsbtn" onClick={onShowStats}>
              Stats
            </button>
          ) : null}
        </nav>
      ) : null}
    </header>
  );
}

/**
 * The persistent top bar for the game loop (WP-10): brand, running xp/level, and
 * the in-session hot-streak flame.
 */
import logoUrl from "../../hivescale-logo.svg";

export interface SessionHeaderProps {
  xp: number;
  level: number;
  streak: number;
  /** When provided, renders a button that opens the stats page. */
  onShowStats?: () => void;
  /** When provided and the session isn't claimed, offers to save progress. */
  onClaim?: () => void;
  /** Whether the session is already tied to an account (WP-11). */
  isClaimed?: boolean;
}

export default function SessionHeader({
  xp,
  level,
  streak,
  onShowStats,
  onClaim,
  isClaimed = false,
}: SessionHeaderProps) {
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
        {onShowStats ? (
          <button type="button" className="bsg-btn bsg-session-statsbtn" onClick={onShowStats}>
            Stats
          </button>
        ) : null}
      </div>
    </header>
  );
}

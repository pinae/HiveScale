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
}

export default function SessionHeader({ xp, level, streak, onShowStats }: SessionHeaderProps) {
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
      {onShowStats ? (
        <button type="button" className="bsg-btn bsg-session-statsbtn" onClick={onShowStats}>
          Stats
        </button>
      ) : null}
    </header>
  );
}

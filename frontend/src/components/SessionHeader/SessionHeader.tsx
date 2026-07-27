/**
 * The persistent top bar for the game loop (WP-10): brand, running xp/level, and
 * the in-session hot-streak flame.
 */
import WaveMark from "../WaveMark";

export interface SessionHeaderProps {
  xp: number;
  level: number;
  streak: number;
}

export default function SessionHeader({ xp, level, streak }: SessionHeaderProps) {
  return (
    <header className="bsg-session-header">
      <div className="bsg-session-brand">
        <WaveMark size={32} />
        <h1 className="bsg-session-title">Baseline Guesser</h1>
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
    </header>
  );
}

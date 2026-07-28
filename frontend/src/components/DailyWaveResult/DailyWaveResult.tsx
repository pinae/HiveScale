/**
 * The Daily Wave payoff (WP-11, plan §2.2): a Wordle-style emoji summary the
 * player can copy and share. Spoiler-free — grades only, never the answers.
 */
import { useState } from "react";

export interface DailyWaveResultProps {
  date: string;
  /** One result emoji per slot, in order. */
  results: string[];
  score: number;
  dailyStreak: number;
  /** The exact text copied to the clipboard (built server-side). */
  shareString: string;
  onDone?: () => void;
}

export default function DailyWaveResult({
  date,
  results,
  score,
  dailyStreak,
  shareString,
  onDone,
}: DailyWaveResultProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(shareString);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="bsg-wave-result" aria-label="Daily Wave result">
      <h2 className="bsg-wave-result-title">Daily Wave complete</h2>
      <p className="bsg-wave-result-date">{date}</p>
      <p className="bsg-wave-result-emoji" data-testid="wave-result-emoji" aria-hidden="true">
        {results.join("")}
      </p>
      <dl className="bsg-wave-result-stats">
        <div>
          <dt>Score</dt>
          <dd data-testid="wave-result-score">{score}</dd>
        </div>
        {dailyStreak > 0 ? (
          <div>
            <dt>Daily streak</dt>
            <dd>🔥 {dailyStreak}</dd>
          </div>
        ) : null}
      </dl>
      <div className="bsg-wave-result-actions">
        <button type="button" className="bsg-btn bsg-btn-primary" onClick={copy}>
          {copied ? "Copied!" : "Copy result"}
        </button>
        {onDone ? (
          <button type="button" className="bsg-btn" onClick={onDone}>
            Back to the game
          </button>
        ) : null}
      </div>
      {copied ? (
        <p className="bsg-wave-result-copied" role="status">
          Result copied — go share your wave!
        </p>
      ) : null}
    </section>
  );
}

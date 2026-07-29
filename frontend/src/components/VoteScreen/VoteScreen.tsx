/**
 * Pairing curation (plan §2.x, level 5+): judge a thing on a scale as fun,
 * interesting, boring, or weird. Fun/interesting promotes a fresh combo into a
 * real pairing; enough boring/weird votes retire a disliked one.
 */
import type { VoteChoice } from "../../api/client";
import ScaleHeader from "../ScaleHeader";
import ThingCard from "../ThingCard";
import { useVoting } from "../../game/useVoting";

export interface VoteScreenProps {
  onExit?: () => void;
  className?: string;
}

const OUTCOME_MESSAGE: Record<string, string> = {
  added: "✨ Added! That pairing is now in play.",
  retired: "🗑️ Retired — the crowd had had enough of that one.",
  recorded: "Vote counted.",
  noted: "Noted — thanks for the signal.",
};

const CHOICES: { choice: VoteChoice; label: string }[] = [
  { choice: "fun", label: "😄 Fun" },
  { choice: "interesting", label: "🤔 Interesting" },
  { choice: "boring", label: "😴 Boring" },
  { choice: "weird", label: "🌀 Weird" },
];

export default function VoteScreen({ onExit, className }: VoteScreenProps) {
  const loop = useVoting();
  const { phase, candidate, lastOutcome } = loop;
  const busy = phase === "submitting" || phase === "loading";

  return (
    <div className={`bsg-vote-screen${className ? ` ${className}` : ""}`}>
      <header className="bsg-vote-head">
        <h2 className="bsg-vote-head-title">🗳️ Curate pairings</h2>
        {onExit ? (
          <button type="button" className="bsg-btn bsg-vote-exit" onClick={onExit}>
            Back to the game
          </button>
        ) : null}
      </header>

      <main className="bsg-play-body">
        {lastOutcome ? (
          <p className="bsg-toast" role="status">
            {OUTCOME_MESSAGE[lastOutcome] ?? "Vote counted."}
          </p>
        ) : null}

        {phase === "error" ? (
          <div className="bsg-play-error" role="alert">
            <p>{loop.error}</p>
            <button type="button" className="bsg-btn" onClick={loop.retry}>
              Try again
            </button>
          </div>
        ) : phase === "empty" ? (
          <p className="bsg-play-loading" role="status">
            Nothing to vote on right now — check back once there are more things and scales.
          </p>
        ) : candidate ? (
          <section className="bsg-vote-round">
            <p className="bsg-vote-prompt">
              {candidate.existing
                ? "Existing pairing — does it still earn its place?"
                : "New combo — is it worth adding to the game?"}
            </p>
            <ThingCard text={candidate.thing.text} />
            <ScaleHeader left={candidate.scale.left} right={candidate.scale.right} />
            <div className="bsg-vote-choices">
              {CHOICES.map(({ choice, label }) => (
                <button
                  key={choice}
                  type="button"
                  className="bsg-btn bsg-vote-choice"
                  data-choice={choice}
                  onClick={() => loop.vote(choice)}
                  disabled={busy}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <p className="bsg-play-loading" role="status">
            Finding a pairing…
          </p>
        )}
      </main>
    </div>
  );
}

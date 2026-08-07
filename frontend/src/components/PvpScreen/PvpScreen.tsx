/**
 * A PvP match, played slot by slot (the Daily Wave shape, with an opponent).
 *
 * The one new beat is the **barrier**: between rounds both players say "ready"
 * and the question only appears once both are in, so the speed race is fair.
 * After each answer the reveal is followed by how you stand — ahead, behind, or
 * first to the round — plus a ⚡ badge when the next round is doubled.
 */
import PvpResult from "../PvpResult";
import RevealWave from "../RevealWave";
import ScaleHeader from "../ScaleHeader";
import ThingCard from "../ThingCard";
import WaveSlider from "../WaveSlider";
import { usePvpMatch } from "../../game/usePvpMatch";

export interface PvpScreenProps {
  joinCode: string;
  onExit?: () => void;
  className?: string;
}

/** How you stand on the round you just answered. */
function standing(
  index: number,
  yourScore: number,
  theirScore: number,
  opponentAnswered: number,
): string {
  if (opponentAnswered <= index) {
    return "You got there first — your friend hasn't answered this one yet.";
  }
  const diff = Math.round(yourScore - theirScore);
  if (diff > 0) return `You lead by ${diff} points.`;
  if (diff < 0) return `Your friend leads by ${-diff} points.`;
  return "Dead level.";
}

export default function PvpScreen({ joinCode, onExit, className }: PvpScreenProps) {
  const loop = usePvpMatch(joinCode);
  const { phase, match, reveal, submittedGuess } = loop;

  return (
    <div className={`bsg-wave-screen${className ? ` ${className}` : ""}`}>
      <header className="bsg-wave-head">
        <h2 className="bsg-wave-head-title">⚔️ Battle</h2>
        {match ? (
          <p className="bsg-wave-progress" data-testid="pvp-progress">
            <span className="bsg-wave-progress-count">
              You {Math.round(match.you.score)} · Friend {Math.round(match.opponent.score)}
            </span>
            <span className="bsg-wave-progress-count">
              {match.you.answered} / {match.total}
            </span>
          </p>
        ) : null}
        {onExit ? (
          <button type="button" className="bsg-btn bsg-wave-exit" onClick={onExit}>
            Back to the game
          </button>
        ) : null}
      </header>

      <main className="bsg-play-body">
        {phase === "error" ? (
          <div className="bsg-play-error" role="alert">
            <p>{loop.error}</p>
            <button type="button" className="bsg-btn" onClick={loop.retry}>
              Try again
            </button>
          </div>
        ) : phase === "loading" ? (
          <p className="bsg-play-loading" role="status">
            Loading the battle…
          </p>
        ) : phase === "waiting" ? (
          <div className="bsg-pvp-waiting" role="status">
            <p className="bsg-play-loading">
              {match?.opponent_joined
                ? "Waiting for your friend to be ready…"
                : "Waiting for your friend to join…"}
            </p>
            <p className="bsg-pvp-option-hint">
              The question appears for both of you at the same moment, so whoever answers
              faster really was faster.
            </p>
          </div>
        ) : phase === "done" && match?.result ? (
          <PvpResult
            result={match.result}
            yourEntries={match.you.entries}
            opponentEntries={match.opponent.entries}
            yourScore={match.you.score}
            opponentScore={match.opponent.score}
            rounds={match.total}
            onDone={onExit}
          />
        ) : phase === "awaiting-result" && match ? (
          <div className="bsg-pvp-waiting" role="status" data-testid="pvp-awaiting-result">
            <p className="bsg-play-loading">
              {!match.opponent_joined
                ? "All done! Waiting for a friend to take your challenge…"
                : `All done! Waiting for your friend to finish their ${
                    match.total - match.opponent.answered
                  } remaining ${match.total - match.opponent.answered === 1 ? "round" : "rounds"}…`}
            </p>
            <p className="bsg-pvp-option-hint">
              You scored {Math.round(match.you.score)}. The result appears here as soon as they
              finish — you can leave and come back to this link.
            </p>
            {onExit ? (
              <button type="button" className="bsg-btn" onClick={onExit}>
                Back to the game
              </button>
            ) : null}
          </div>
        ) : phase === "done" ? (
          <p className="bsg-play-loading" role="status">
            Waiting for your friend to finish their rounds…
          </p>
        ) : phase === "revealing" && reveal && submittedGuess && match ? (
          <section className="bsg-play-reveal">
            <RevealWave reveal={reveal} guess={submittedGuess} />
            {reveal.speed_bonus ? (
              <p className="bsg-pvp-bonus" role="status">
                ⚡ Speed bonus — that round scored double.
              </p>
            ) : null}
            <p className="bsg-pvp-standing" role="status">
              {standing(
                match.you.answered - 1,
                match.you.score,
                match.opponent.score,
                match.opponent.answered,
              )}
            </p>
            {match.speed_bonus_next ? (
              <p className="bsg-pvp-bonus" role="status">
                ⚡ You were faster — your next round is worth double.
              </p>
            ) : null}
            <button type="button" className="bsg-btn bsg-btn-primary" onClick={loop.next}>
              {match.completed || match.next === null ? "See the result" : "Next round"}
            </button>
          </section>
        ) : phase === "guessing" && match?.next?.thing && match.next.scale ? (
          <section className="bsg-play-round">
            {match.speed_bonus_next ? (
              <p className="bsg-pvp-bonus" role="status">
                ⚡ Double points this round
              </p>
            ) : null}
            <ThingCard text={match.next.thing.text} />
            <ScaleHeader left={match.next.scale.left} right={match.next.scale.right} />
            <WaveSlider value={loop.guess} onChange={loop.setGuess} />
            <button
              type="button"
              className="bsg-btn bsg-btn-primary"
              onClick={loop.submit}
              disabled={phase !== "guessing"}
            >
              Lock it in
            </button>
          </section>
        ) : (
          <p className="bsg-play-loading" role="status">
            Revealing…
          </p>
        )}
      </main>
    </div>
  );
}

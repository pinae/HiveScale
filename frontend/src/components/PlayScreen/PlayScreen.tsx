/**
 * The game loop screen (WP-10): deal → guess → reveal → next, with a persistent
 * score header, optimistic submit, a too-fast toast, and error/offline retry.
 * Next rounds are preloaded during the reveal so advancing is instant.
 */
import RevealWave from "../RevealWave";
import ScaleHeader from "../ScaleHeader";
import SessionHeader from "../SessionHeader";
import ThingCard from "../ThingCard";
import WaveSlider from "../WaveSlider";
import { useGameLoop } from "../../game/useGameLoop";

export interface PlayScreenProps {
  className?: string;
}

export default function PlayScreen({ className }: PlayScreenProps) {
  const loop = useGameLoop();
  const { phase, round, reveal, submittedGuess, profile, streak } = loop;

  return (
    <div className={`bsg-play${className ? ` ${className}` : ""}`}>
      <SessionHeader xp={profile.xp} level={profile.level} streak={streak} />

      <main className="bsg-play-body">
        {phase === "error" ? (
          <div className="bsg-play-error" role="alert">
            <p>{loop.error}</p>
            <button type="button" className="bsg-btn" onClick={loop.retry}>
              Try again
            </button>
          </div>
        ) : phase === "booting" || phase === "advancing" ? (
          <p className="bsg-play-loading" role="status">
            Dealing a round…
          </p>
        ) : reveal && submittedGuess ? (
          <section className="bsg-play-reveal">
            <RevealWave reveal={reveal} guess={submittedGuess} />
            {reveal.counted ? null : (
              <p className="bsg-toast" role="alert">
                Too fast — that one didn&apos;t count!
              </p>
            )}
            <button type="button" className="bsg-btn bsg-btn-primary" onClick={loop.next}>
              Next round
            </button>
          </section>
        ) : round ? (
          <section className="bsg-play-round">
            <ThingCard text={round.thing.text} />
            <ScaleHeader left={round.scale.left} right={round.scale.right} />
            <WaveSlider
              value={loop.guess}
              onChange={loop.setGuess}
              disabled={phase === "submitting"}
            />
            <button
              type="button"
              className="bsg-btn bsg-btn-primary"
              onClick={loop.submit}
              disabled={phase === "submitting"}
            >
              {phase === "submitting" ? "Revealing…" : "Lock it in"}
            </button>
          </section>
        ) : null}
      </main>
    </div>
  );
}

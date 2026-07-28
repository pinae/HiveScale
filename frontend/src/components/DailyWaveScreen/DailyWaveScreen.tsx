/**
 * The Daily Wave screen (WP-11, plan §2.2): play today's shared set slot by
 * slot with a live emoji progress strip, then land on the shareable result.
 * Reuses the round primitives (ThingCard, ScaleHeader, WaveSlider, RevealWave).
 */
import DailyWaveResult from "../DailyWaveResult";
import RevealWave from "../RevealWave";
import ScaleHeader from "../ScaleHeader";
import ThingCard from "../ThingCard";
import WaveSlider from "../WaveSlider";
import { useDailyWave } from "../../game/useDailyWave";

export interface DailyWaveScreenProps {
  /** Return to the main game loop. */
  onExit?: () => void;
  className?: string;
}

export default function DailyWaveScreen({ onExit, className }: DailyWaveScreenProps) {
  const loop = useDailyWave();
  const { phase, wave, slot, reveal, submittedGuess } = loop;
  const lastSlot = wave !== null && (wave.completed || wave.next === null);

  return (
    <div className={`bsg-wave-screen${className ? ` ${className}` : ""}`}>
      <header className="bsg-wave-head">
        <h2 className="bsg-wave-head-title">🌊 Daily Wave</h2>
        {wave ? (
          <p className="bsg-wave-progress" data-testid="wave-progress">
            <span className="bsg-wave-progress-emoji" aria-hidden="true">
              {wave.results.join("")}
            </span>
            <span className="bsg-wave-progress-count">
              {wave.answered} / {wave.total}
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
            Loading today&apos;s wave…
          </p>
        ) : phase === "done" && wave ? (
          <DailyWaveResult
            date={wave.date}
            results={wave.results}
            score={wave.score}
            dailyStreak={wave.daily_streak}
            shareString={wave.share_string ?? ""}
            onDone={onExit}
          />
        ) : phase === "revealing" && reveal && submittedGuess ? (
          <section className="bsg-play-reveal">
            <RevealWave reveal={reveal} guess={submittedGuess} />
            {reveal.counted ? null : (
              <p className="bsg-toast" role="alert">
                Too fast — that one didn&apos;t count!
              </p>
            )}
            <button type="button" className="bsg-btn bsg-btn-primary" onClick={loop.next}>
              {lastSlot ? "See your result" : "Next slot"}
            </button>
          </section>
        ) : phase === "guessing" && slot ? (
          <section className="bsg-play-round">
            <ThingCard text={slot.thing.text} />
            <ScaleHeader left={slot.scale.left} right={slot.scale.right} />
            <WaveSlider value={loop.guess} onChange={loop.setGuess} />
            <button type="button" className="bsg-btn bsg-btn-primary" onClick={loop.submit}>
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

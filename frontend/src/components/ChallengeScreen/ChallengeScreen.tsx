/**
 * Thing challenges (plan §2.x, level 10+): invent a thing (≤3 words) that maxes
 * one scale and mins another. A completed challenge banks a big flat bonus and
 * files the thing for the pool. Reuses ScaleHeader to show the two poles.
 */
import { useState } from "react";
import type { FormEvent } from "react";

import type { ChallengeResult } from "../../api/client";
import ScaleHeader from "../ScaleHeader";
import { useChallenge } from "../../game/useChallenge";

export interface ChallengeScreenProps {
  /** Fold the banked XP into the running profile. */
  onReward: (result: ChallengeResult) => void;
  onExit?: () => void;
  className?: string;
}

export default function ChallengeScreen({ onReward, onExit, className }: ChallengeScreenProps) {
  const loop = useChallenge(onReward);
  const { phase, deal } = loop;
  const [text, setText] = useState("");

  function handleSubmit(ev: FormEvent) {
    ev.preventDefault();
    loop.submit(text);
  }

  function another() {
    setText("");
    loop.again();
  }

  return (
    <div className={`bsg-challenge-screen${className ? ` ${className}` : ""}`}>
      <header className="bsg-challenge-head">
        <h2 className="bsg-challenge-head-title">🧩 Thing challenge</h2>
        {onExit ? (
          <button type="button" className="bsg-btn bsg-challenge-exit" onClick={onExit}>
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
        ) : phase === "empty" ? (
          <p className="bsg-play-loading" role="status">
            No challenge available yet — there need to be at least two scales.
          </p>
        ) : phase === "done" && loop.lastResult ? (
          <section className="bsg-challenge-done">
            <p className="bsg-toast" role="status">
              ✨ +{loop.lastResult.xp_awarded.toLocaleString()} XP — “{loop.lastResult.text}” is in
              the pool for review.
            </p>
            <div className="bsg-challenge-actions">
              <button type="button" className="bsg-btn bsg-btn-primary" onClick={another}>
                Another challenge
              </button>
              {onExit ? (
                <button type="button" className="bsg-btn" onClick={onExit}>
                  Back to the game
                </button>
              ) : null}
            </div>
          </section>
        ) : deal ? (
          <form className="bsg-challenge-round" onSubmit={handleSubmit}>
            <p className="bsg-challenge-prompt">
              Name a thing in <strong>{deal.max_words} words</strong> or fewer that is as{" "}
              <strong>{deal.first_scale.right}</strong> as possible — yet as far from{" "}
              <strong>{deal.second_scale.right}</strong> as it gets.
            </p>
            <div className="bsg-challenge-scales">
              <ScaleHeader left={deal.first_scale.left} right={deal.first_scale.right} />
              <ScaleHeader left={deal.second_scale.left} right={deal.second_scale.right} />
            </div>
            <label className="bsg-challenge-field">
              <span>Your thing</span>
              <input
                type="text"
                value={text}
                maxLength={120}
                placeholder="e.g. sentient toaster"
                onChange={(ev) => setText(ev.target.value)}
                disabled={phase === "submitting"}
              />
            </label>
            {loop.error ? (
              <p className="bsg-claim-error" role="alert">
                {loop.error}
              </p>
            ) : null}
            <button
              type="submit"
              className="bsg-btn bsg-btn-primary"
              disabled={phase === "submitting" || !text.trim()}
            >
              {phase === "submitting"
                ? "Submitting…"
                : `Submit for +${deal.reward_xp.toLocaleString()} XP`}
            </button>
          </form>
        ) : (
          <p className="bsg-play-loading" role="status">
            Dealing a challenge…
          </p>
        )}
      </main>
    </div>
  );
}

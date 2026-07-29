/**
 * Scale requests (plan §2.x, level 15+): invent a surprising new scale for a
 * randomly chosen thing, once a day. The thing's existing scales are shown as
 * "already taken" so the player reaches for something fresh.
 */
import { useState } from "react";
import type { FormEvent } from "react";

import ThingCard from "../ThingCard";
import { useScaleRequest } from "../../game/useScaleRequest";

export interface ScaleRequestScreenProps {
  onExit?: () => void;
  className?: string;
}

export default function ScaleRequestScreen({ onExit, className }: ScaleRequestScreenProps) {
  const loop = useScaleRequest();
  const { phase, prompt } = loop;
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");

  function handleSubmit(ev: FormEvent) {
    ev.preventDefault();
    loop.submit(left, right);
  }

  return (
    <div className={`bsg-scalereq-screen${className ? ` ${className}` : ""}`}>
      <header className="bsg-scalereq-head">
        <h2 className="bsg-scalereq-head-title">📐 Craft a scale</h2>
        {onExit ? (
          <button type="button" className="bsg-btn bsg-scalereq-exit" onClick={onExit}>
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
            Finding a thing…
          </p>
        ) : phase === "unavailable" ? (
          <p className="bsg-play-loading" role="status">
            {prompt?.reason ?? "No scale prompt available right now."}
          </p>
        ) : phase === "done" && loop.result ? (
          <section className="bsg-scalereq-done">
            <p className="bsg-toast" role="status">
              📐 Filed “{loop.result.left} ↔ {loop.result.right}” — it enters play once approved.
            </p>
            {onExit ? (
              <button type="button" className="bsg-btn bsg-btn-primary" onClick={onExit}>
                Back to the game
              </button>
            ) : null}
          </section>
        ) : prompt?.thing ? (
          <form className="bsg-scalereq-round" onSubmit={handleSubmit}>
            <p className="bsg-scalereq-prompt">Invent a surprising new scale for:</p>
            <ThingCard text={prompt.thing.text} />
            {prompt.examples && prompt.examples.length > 0 ? (
              <div className="bsg-scalereq-examples">
                <p className="bsg-scalereq-examples-title">Already taken — pick something else:</p>
                <ul>
                  {prompt.examples.map((e, i) => (
                    <li key={i}>
                      {e.left} ↔ {e.right}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="bsg-scalereq-poles">
              <label className="bsg-scalereq-field">
                <span>One pole</span>
                <input
                  type="text"
                  value={left}
                  maxLength={60}
                  placeholder="e.g. cosmic"
                  onChange={(ev) => setLeft(ev.target.value)}
                  disabled={phase === "submitting"}
                />
              </label>
              <label className="bsg-scalereq-field">
                <span>The other pole</span>
                <input
                  type="text"
                  value={right}
                  maxLength={60}
                  placeholder="e.g. mundane"
                  onChange={(ev) => setRight(ev.target.value)}
                  disabled={phase === "submitting"}
                />
              </label>
            </div>
            {loop.error ? (
              <p className="bsg-claim-error" role="alert">
                {loop.error}
              </p>
            ) : null}
            <button
              type="submit"
              className="bsg-btn bsg-btn-primary"
              disabled={phase === "submitting" || !left.trim() || !right.trim()}
            >
              {phase === "submitting" ? "Filing…" : "File my scale"}
            </button>
          </form>
        ) : null}
      </main>
    </div>
  );
}

/**
 * Explainer card shown when a player crosses a level that unlocks a new
 * capability (2, 5, 10, 15). A dismissible modal that says what just opened up
 * and how to use it.
 */
import { useEffect, useRef } from "react";

interface Content {
  emoji: string;
  title: string;
  lines: string[];
}

const CONTENT: Record<number, Content> = {
  2: {
    emoji: "⚡",
    title: "XP multiplier unlocked",
    lines: [
      "Calibrated guessing now pays off. When your interval covers at least 70% of the crowd, your XP multiplier climbs by one — up to ×10 — and every round's XP is multiplied by it.",
      "A poorly-covered round resets it to ×1, and a round the crowd is split on leaves it untouched. Tight, accurate intervals are the way to load it up.",
    ],
  },
  3: {
    emoji: "🌊",
    title: "Daily Wave unlocked",
    lines: [
      "Every day there's one shared set of pairings — the same for every player — that you can play once. Tap “Daily” in the header to take today's.",
      "Finish all of them and you get a Wordle-style emoji result you can copy and share.",
    ],
  },
  5: {
    emoji: "🗳️",
    title: "Pairing voting unlocked",
    lines: [
      "Tap “Vote” in the header to help curate the game. Judge each thing-on-a-scale as fun, interesting, boring, or weird.",
      "A fun or interesting vote on a fresh combo adds it to the game; combos the crowd keeps calling boring or weird get retired.",
    ],
  },
  10: {
    emoji: "🧩",
    title: "Thing challenges unlocked",
    lines: [
      "Tap “Challenge” for a creative prompt: name a thing in three words or fewer that maxes one scale and mins another.",
      "Each thing you submit joins the pool for review — and banks a hefty 25,000 XP bonus.",
    ],
  },
  15: {
    emoji: "📐",
    title: "Scale requests unlocked",
    lines: [
      "Tap “Scale” once a day to invent a brand-new scale for a randomly chosen thing.",
      "We'll show you the scales it already has, so you can surprise us with something genuinely fresh.",
    ],
  },
};

export interface LevelUpCardProps {
  level: number;
  onDismiss: () => void;
}

export default function LevelUpCard({ level, onDismiss }: LevelUpCardProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const content = CONTENT[level];

  useEffect(() => {
    buttonRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  if (!content) return null;

  return (
    <div className="bsg-levelup-backdrop" onClick={onDismiss}>
      <section
        className="bsg-levelup-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bsg-levelup-title"
        data-level={level}
        onClick={(ev) => ev.stopPropagation()}
      >
        <p className="bsg-levelup-badge">Level {level}</p>
        <h2 id="bsg-levelup-title" className="bsg-levelup-title">
          <span aria-hidden="true">{content.emoji}</span> {content.title}
        </h2>
        {content.lines.map((line, i) => (
          <p key={i} className="bsg-levelup-line">
            {line}
          </p>
        ))}
        <button ref={buttonRef} type="button" className="bsg-btn bsg-btn-primary" onClick={onDismiss}>
          Got it
        </button>
      </section>
    </div>
  );
}

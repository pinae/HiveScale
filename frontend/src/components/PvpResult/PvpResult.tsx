/**
 * The end of a PvP match: who won, by how much, and *how* each player got there.
 *
 * The diagram is the point. Every answered round is a vector
 * `(means match, belief match)`, laid tip-to-tail from the origin, so each player
 * draws a path across the square. A perfect run would march straight up the
 * diagonal to the far corner; real play winds — leaning right if you read where
 * people *land*, leaning up if you read what they *believe*. Whoever's chain
 * ends nearest the top-right corner wins.
 */
import type { PvpEntry, PvpResultSummary } from "../../api/client";
import { chainPoints, toSvgPoints } from "../../game/pvpDiagram";

export interface PvpResultProps {
  result: PvpResultSummary;
  yourEntries: PvpEntry[];
  opponentEntries: PvpEntry[];
  yourScore: number;
  opponentScore: number;
  rounds: number;
  onDone?: () => void;
  className?: string;
}

const VB = 320; // viewBox side
const PAD_LEFT = 44;
const PAD_BOTTOM = 40;
const PAD_TOP = 16;
const PLOT = VB - PAD_LEFT - PAD_TOP; // the drawable square's side

const HEADLINE: Record<PvpResultSummary["winner"], string> = {
  you: "🏆 You win!",
  opponent: "Your friend takes it.",
  tie: "Dead heat!",
};

/** One player's chain, drawn as connected arrows. */
function Chain({
  entries,
  span,
  color,
  markerId,
  label,
}: {
  entries: PvpEntry[];
  /** Shared axis maximum, so both players are drawn to one honest scale. */
  span: number;
  color: string;
  markerId: string;
  label: string;
}) {
  const points = toSvgPoints(chainPoints(entries), PLOT, span, PAD_LEFT, VB - PAD_BOTTOM);
  return (
    <g className="bsg-pvp-chain" data-player={label}>
      {points.slice(1).map((p, i) => (
        <line
          key={i}
          x1={points[i].x}
          y1={points[i].y}
          x2={p.x}
          y2={p.y}
          stroke={color}
          strokeWidth={2}
          markerEnd={`url(#${markerId})`}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {points.length > 1 ? (
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={4} fill={color} />
      ) : null}
    </g>
  );
}

export default function PvpResult({
  result,
  yourEntries,
  opponentEntries,
  yourScore,
  opponentScore,
  rounds,
  onDone,
  className,
}: PvpResultProps) {
  // Both chains share one axis scale so the comparison is honest.
  const span = Math.max(rounds, yourEntries.length, opponentEntries.length, 1);
  const diagonalEnd = toSvgPoints([{ x: span, y: span }], PLOT, span, PAD_LEFT, VB - PAD_BOTTOM)[0];

  const arrow = (id: string, color: string) => (
    <marker id={id} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill={color} />
    </marker>
  );

  return (
    <section className={`bsg-pvp-result${className ? ` ${className}` : ""}`} aria-label="Battle result">
      <h2 className="bsg-pvp-result-title" data-winner={result.winner}>
        {HEADLINE[result.winner]}
      </h2>
      <p className="bsg-pvp-result-margin">
        {result.winner === "tie"
          ? "You both reached exactly as far. Rematch?"
          : `Ahead by ${result.margin.toFixed(2)} on the board — ${Math.round(result.score_margin)} points.`}
      </p>

      <dl className="bsg-pvp-result-scores">
        <div>
          <dt>You</dt>
          <dd data-testid="pvp-your-score">{Math.round(yourScore)}</dd>
        </div>
        <div>
          <dt>Friend</dt>
          <dd data-testid="pvp-their-score">{Math.round(opponentScore)}</dd>
        </div>
      </dl>

      <figure className="bsg-pvp-figure">
        <svg
          className="bsg-pvp-diagram"
          data-testid="pvp-diagram"
          viewBox={`0 0 ${VB} ${VB}`}
          role="img"
          aria-label={
            `Match paths: means match across, belief match up. ` +
            `You reached ${result.you_end.x.toFixed(1)} by ${result.you_end.y.toFixed(1)}; ` +
            `your friend reached ${result.opponent_end.x.toFixed(1)} by ${result.opponent_end.y.toFixed(1)}.`
          }
        >
          <defs>
            {arrow("bsg-arrow-you", "var(--bsg-wave)")}
            {arrow("bsg-arrow-them", "var(--bsg-accent)")}
          </defs>

          {/* The perfect run: straight up the diagonal to the far corner. */}
          <line
            className="bsg-pvp-diagonal"
            x1={PAD_LEFT}
            y1={VB - PAD_BOTTOM}
            x2={diagonalEnd.x}
            y2={diagonalEnd.y}
          />
          {/* Axes. */}
          <line
            className="bsg-pvp-axis"
            x1={PAD_LEFT}
            y1={VB - PAD_BOTTOM}
            x2={PAD_LEFT + PLOT}
            y2={VB - PAD_BOTTOM}
          />
          <line
            className="bsg-pvp-axis"
            x1={PAD_LEFT}
            y1={VB - PAD_BOTTOM}
            x2={PAD_LEFT}
            y2={VB - PAD_BOTTOM - PLOT}
          />
          <text className="bsg-pvp-axis-label" x={PAD_LEFT + PLOT / 2} y={VB - 8} textAnchor="middle">
            means match →
          </text>
          <text
            className="bsg-pvp-axis-label"
            x={0}
            y={0}
            textAnchor="middle"
            transform={`translate(14, ${VB - PAD_BOTTOM - PLOT / 2}) rotate(-90)`}
          >
            belief match →
          </text>

          <Chain
            entries={opponentEntries}
            span={span}
            color="var(--bsg-accent)"
            markerId="bsg-arrow-them"
            label="opponent"
          />
          <Chain
            entries={yourEntries}
            span={span}
            color="var(--bsg-wave)"
            markerId="bsg-arrow-you"
            label="you"
          />
        </svg>
        <figcaption className="bsg-pvp-legend">
          <span className="bsg-pvp-key" data-player="you">
            You
          </span>
          <span className="bsg-pvp-key" data-player="opponent">
            Friend
          </span>
          <span className="bsg-pvp-key" data-player="perfect">
            Perfect run
          </span>
        </figcaption>
      </figure>

      {onDone ? (
        <button type="button" className="bsg-btn bsg-btn-primary" onClick={onDone}>
          Back to the game
        </button>
      ) : null}
    </section>
  );
}

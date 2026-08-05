/**
 * The game loop screen (WP-10): deal → guess → reveal → next, with a persistent
 * score header, optimistic submit, a too-fast toast, and error/offline retry.
 * Next rounds are preloaded during the reveal so advancing is instant.
 *
 * It also hosts the two out-of-loop pages reached from the header — the stats
 * page (WP-11) and the account-claim panel (WP-11/§2.6) — and confirms a claim
 * magic link if the app was opened from one.
 */
import { useState } from "react";

import ChallengeScreen from "../ChallengeScreen";
import ClaimPanel from "../ClaimPanel";
import DailyWaveScreen from "../DailyWaveScreen";
import LevelUpCard from "../LevelUpCard";
import RevealWave from "../RevealWave";
import ScaleRequestScreen from "../ScaleRequestScreen";
import VoteScreen from "../VoteScreen";
import ScaleHeader from "../ScaleHeader";
import SessionHeader from "../SessionHeader";
import StatsPanel from "../StatsPanel";
import ThingCard from "../ThingCard";
import WaveSlider from "../WaveSlider";
import { type Stats, fetchStats } from "../../api/client";
import { useGameLoop } from "../../game/useGameLoop";
import { useMagicLinkClaim } from "../../game/useMagicLinkClaim";

export interface PlayScreenProps {
  className?: string;
}

export default function PlayScreen({ className }: PlayScreenProps) {
  const loop = useGameLoop();
  const { phase, round, reveal, submittedGuess, profile, streak } = loop;

  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [showClaim, setShowClaim] = useState(false);
  const [showDailyWave, setShowDailyWave] = useState(false);
  const [showVote, setShowVote] = useState(false);
  const [showChallenge, setShowChallenge] = useState(false);
  const [showScaleRequest, setShowScaleRequest] = useState(false);

  // A claim magic link (?claim=…) confirms itself on load and folds in the
  // resulting profile; its notice is surfaced above the game.
  const claimNotice = useMagicLinkClaim((result) => loop.markClaimed(result.player));

  async function openStats() {
    setShowStats(true);
    setStats(null);
    setStatsError(false);
    try {
      setStats(await fetchStats());
    } catch {
      setStatsError(true);
    }
  }

  const rootClass = `bsg-play${className ? ` ${className}` : ""}`;

  if (showDailyWave) {
    return (
      <div className={rootClass}>
        <DailyWaveScreen onExit={() => setShowDailyWave(false)} />
      </div>
    );
  }

  if (showVote) {
    return (
      <div className={rootClass}>
        <VoteScreen onExit={() => setShowVote(false)} />
      </div>
    );
  }

  if (showChallenge) {
    return (
      <div className={rootClass}>
        <ChallengeScreen
          onReward={(result) =>
            loop.syncProfile({
              ...result.player,
              progress: result.progress,
              unlocks: result.unlocks,
            })
          }
          onExit={() => setShowChallenge(false)}
        />
      </div>
    );
  }

  if (showScaleRequest) {
    return (
      <div className={rootClass}>
        <ScaleRequestScreen onExit={() => setShowScaleRequest(false)} />
      </div>
    );
  }

  if (showClaim) {
    return (
      <div className={rootClass}>
        <SessionHeader
          xp={profile.xp}
          level={profile.level}
          streak={streak}
          multiplier={profile.multiplier}
          progress={profile.progress}
          isClaimed={loop.isClaimed}
        />
        <main className="bsg-play-body">
          <ClaimPanel
            onClaimed={(result) => {
              loop.markClaimed(result.player);
              setShowClaim(false);
            }}
            onCancel={() => setShowClaim(false)}
          />
        </main>
      </div>
    );
  }

  if (showStats) {
    return (
      <div className={rootClass}>
        <SessionHeader
          xp={profile.xp}
          level={profile.level}
          streak={streak}
          multiplier={profile.multiplier}
          progress={profile.progress}
          isClaimed={loop.isClaimed}
        />
        <main className="bsg-play-body">
          {stats ? (
            <StatsPanel stats={stats} />
          ) : statsError ? (
            <p className="bsg-play-error" role="alert">
              Couldn&apos;t load your stats.
            </p>
          ) : (
            <p className="bsg-play-loading" role="status">
              Loading your stats…
            </p>
          )}
          <button type="button" className="bsg-btn" onClick={() => setShowStats(false)}>
            Back to the game
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      <SessionHeader
        xp={profile.xp}
        level={profile.level}
        streak={streak}
        multiplier={profile.multiplier}
        progress={profile.progress}
        onShowStats={openStats}
        onDailyWave={profile.unlocks.daily_wave ? () => setShowDailyWave(true) : undefined}
        onVote={profile.unlocks.vote ? () => setShowVote(true) : undefined}
        onChallenge={profile.unlocks.challenge ? () => setShowChallenge(true) : undefined}
        onScaleRequest={profile.unlocks.scale ? () => setShowScaleRequest(true) : undefined}
        onClaim={() => setShowClaim(true)}
        isClaimed={loop.isClaimed}
      />

      <main className="bsg-play-body">
        {claimNotice ? (
          <p className="bsg-toast" role="status">
            {claimNotice}
          </p>
        ) : null}
        {loop.notice ? (
          <p className="bsg-toast" role="status">
            {loop.notice}
          </p>
        ) : null}
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

      {loop.pendingMilestones.length > 0 ? (
        <LevelUpCard level={loop.pendingMilestones[0]} onDismiss={loop.dismissMilestone} />
      ) : null}
    </div>
  );
}

/**
 * The round-loop state machine (WP-10).
 *
 * Phases: booting -> guessing -> submitting -> revealing -> (next) guessing.
 * While a reveal is on screen the *next* round is preloaded in the background so
 * tapping "Next" is instant (plan §2.3). Any failed step drops into an `error`
 * phase whose `retry` re-runs exactly what failed.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  type Profile,
  type Round,
  fetchNextRound,
  startSession,
  submitGuess,
} from "../api/client";
import type { LevelProgress, RevealPayload, Unlocks } from "../api/reveal";
import type { GuessValue } from "../components/WaveSlider";

export type Phase = "booting" | "guessing" | "submitting" | "revealing" | "advancing" | "error";

export const DEFAULT_GUESS: GuessValue = { center: 50, widthLeft: 15, widthRight: 15 };

const NO_UNLOCKS: Unlocks = { daily_wave: false, vote: false, challenge: false, scale: false };

/** Levels that unlock a new capability and get an explainer card. */
export const MILESTONE_LEVELS = [2, 3, 5, 10, 15];

/** How many recently-dealt pairings the client remembers to avoid quick repeats.
 * Deliberately long: repeats within a session are more annoying than the extra
 * pioneer rounds a deep exclusion trades for (must stay ≤ the backend's
 * MAX_EXCLUDE_IDS or the tail is dropped). */
export const SEEN_WINDOW = 150;

/** Running player progression surfaced in the header (xp/level/multiplier). */
export interface ProfileState {
  xp: number;
  level: number;
  multiplier: number;
  progress: LevelProgress | null;
  unlocks: Unlocks;
}

type FailedAction = "boot" | "submit" | "next";

const profileFrom = (
  p: { xp: number; level: number; multiplier?: number; progress?: LevelProgress; unlocks?: Unlocks },
  progress: LevelProgress | null = p.progress ?? null,
  unlocks: Unlocks = p.unlocks ?? NO_UNLOCKS,
): ProfileState => ({
  xp: p.xp,
  level: p.level,
  multiplier: p.multiplier ?? 1,
  progress,
  unlocks,
});

export interface GameLoop {
  phase: Phase;
  round: Round | null;
  guess: GuessValue;
  setGuess: (g: GuessValue) => void;
  reveal: RevealPayload | null;
  submittedGuess: GuessValue | null;
  profile: ProfileState;
  streak: number;
  isClaimed: boolean;
  /** Unlock milestones just crossed during play, awaiting an explainer card. */
  pendingMilestones: number[];
  dismissMilestone: () => void;
  error: string | null;
  /** A transient, non-blocking toast (e.g. a timed-out round was re-dealt). */
  notice: string | null;
  submit: () => void;
  next: () => void;
  retry: () => void;
  /** Fold in the profile returned by a successful account claim (WP-11/12). */
  markClaimed: (profile: Profile) => void;
  /** Update the running profile from any progression response (e.g. a challenge). */
  syncProfile: (p: {
    xp: number;
    level: number;
    multiplier?: number;
    progress?: LevelProgress;
    unlocks?: Unlocks;
  }) => void;
}

export function useGameLoop(): GameLoop {
  const [phase, setPhase] = useState<Phase>("booting");
  const [round, setRound] = useState<Round | null>(null);
  const [guess, setGuess] = useState<GuessValue>(DEFAULT_GUESS);
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [submittedGuess, setSubmittedGuess] = useState<GuessValue | null>(null);
  const [profile, setProfile] = useState<ProfileState>({
    xp: 0,
    level: 1,
    multiplier: 1,
    progress: null,
    unlocks: NO_UNLOCKS,
  });
  const [streak, setStreak] = useState(0);
  const [isClaimed, setIsClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A transient, non-blocking toast (e.g. "that round timed out, here's a fresh
  // one") — unlike `error`, it doesn't drop the loop into the error phase.
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingMilestones, setPendingMilestones] = useState<number[]>([]);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const guessRef = useRef(guess);
  const roundRef = useRef<Round | null>(round);
  const preloaded = useRef<Round | null>(null);
  const failedAction = useRef<FailedAction | null>(null);
  const lastLevelRef = useRef(1);
  // Recently-dealt pairing ids, newest first, sent to the backend so it can skip
  // them without tracking per-player history (see fetchNextRound / scheduler).
  const seenRef = useRef<number[]>([]);
  const rememberSeen = useCallback((pairingId: number) => {
    seenRef.current = [pairingId, ...seenRef.current.filter((id) => id !== pairingId)].slice(
      0,
      SEEN_WINDOW,
    );
  }, []);
  useEffect(() => {
    guessRef.current = guess;
    roundRef.current = round;
  });

  // Apply a profile update, and (only for genuine play events) queue an explainer
  // card for any unlock milestone the player just crossed. Boot and account-claim
  // updates pass `checkMilestones = false` so a returning player isn't spammed.
  const applyProfile = useCallback((next: ProfileState, checkMilestones: boolean) => {
    if (checkMilestones && next.level > lastLevelRef.current) {
      const crossed = MILESTONE_LEVELS.filter(
        (m) => lastLevelRef.current < m && m <= next.level,
      );
      if (crossed.length) setPendingMilestones((queue) => [...queue, ...crossed]);
    }
    lastLevelRef.current = next.level;
    setProfile(next);
  }, []);

  const dismissMilestone = useCallback(() => setPendingMilestones((queue) => queue.slice(1)), []);

  const fail = useCallback((action: FailedAction, message: string) => {
    failedAction.current = action;
    setError(message);
    setPhase("error");
  }, []);

  const applyRound = useCallback(
    (r: Round) => {
      rememberSeen(r.pairing_id);
      setRound(r);
      setReveal(null);
      setSubmittedGuess(null);
      setGuess(DEFAULT_GUESS);
      setError(null);
      setPhase("guessing");
    },
    [rememberSeen],
  );

  // Starts at the initial "booting" phase; retry() re-enters it explicitly.
  const boot = useCallback(async () => {
    try {
      const { player } = await startSession();
      // A returning (claimed) player arrives with real xp/level and a claim flag.
      applyProfile(profileFrom(player), false);
      setIsClaimed(player.is_claimed);
      applyRound(await fetchNextRound({ exclude: seenRef.current }));
    } catch {
      fail("boot", "Couldn't reach the game. Check your connection.");
    }
  }, [applyProfile, applyRound, fail]);

  const syncProfile = useCallback(
    (p: {
      xp: number;
      level: number;
      multiplier?: number;
      progress?: LevelProgress;
      unlocks?: Unlocks;
    }) => applyProfile(profileFrom(p, p.progress ?? null, p.unlocks ?? NO_UNLOCKS), true),
    [applyProfile],
  );

  const markClaimed = useCallback(
    (player: Profile) => {
      // A claim/merge can change level, but it isn't a "just reached" moment —
      // update silently without firing an explainer card.
      applyProfile(profileFrom(player), false);
      setIsClaimed(player.is_claimed);
    },
    [applyProfile],
  );

  // The round token (or session) went stale — usually the round sat open past
  // its lifetime. Re-establish the session and deal a fresh round so the player
  // can keep playing instead of hitting a "try again" that can never succeed with
  // the dead token (which previously only a page reload fixed).
  const recoverStaleRound = useCallback(async () => {
    setPhase("advancing");
    setError(null);
    try {
      const { player } = await startSession();
      applyProfile(profileFrom(player), false);
      setIsClaimed(player.is_claimed);
      applyRound(await fetchNextRound({ exclude: seenRef.current }));
      setNotice("That round timed out — here's a fresh one.");
    } catch {
      fail("submit", "Couldn't submit your guess.");
    }
  }, [applyProfile, applyRound, fail]);

  const submit = useCallback(async () => {
    const current = roundRef.current;
    if (!current) return;
    const g = guessRef.current;
    setPhase("submitting");
    setError(null);
    setNotice(null);
    try {
      const rev = await submitGuess({
        round_token: current.round_token,
        center: g.center,
        width_left: g.widthLeft,
        width_right: g.widthRight,
      });
      setReveal(rev);
      setSubmittedGuess(g);
      applyProfile(profileFrom(rev.player, rev.progress ?? null, rev.unlocks ?? NO_UNLOCKS), true);
      setStreak(rev.streak.hot);
      setPhase("revealing");
      // Preload the next round during the reveal (errors surface on Next).
      preloaded.current = null;
      fetchNextRound({ exclude: seenRef.current })
        .then((r) => {
          preloaded.current = r;
        })
        .catch(() => {
          preloaded.current = null;
        });
    } catch (err) {
      // A 400/401 means this token can never succeed (expired round or lapsed
      // session) — recover by dealing fresh. Anything else (a network blip) is
      // genuinely retryable with the same token.
      if (err instanceof ApiError && (err.status === 400 || err.status === 401)) {
        await recoverStaleRound();
      } else {
        fail("submit", "Couldn't submit your guess.");
      }
    }
  }, [applyProfile, fail, recoverStaleRound]);

  const next = useCallback(async () => {
    if (preloaded.current) {
      const r = preloaded.current;
      preloaded.current = null;
      applyRound(r);
      return;
    }
    setPhase("advancing");
    setError(null);
    try {
      applyRound(await fetchNextRound({ exclude: seenRef.current }));
    } catch {
      fail("next", "Couldn't load the next round.");
    }
  }, [applyRound, fail]);

  const retry = useCallback(() => {
    setError(null);
    if (failedAction.current === "submit") submit();
    else if (failedAction.current === "next") next();
    else {
      setPhase("booting");
      boot();
    }
  }, [boot, submit, next]);

  useEffect(() => {
    // Deal the first round on mount — the accepted data-loading use of an
    // effect; boot() only updates state in its async continuation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    boot();
  }, [boot]);

  return {
    phase,
    round,
    guess,
    setGuess,
    reveal,
    submittedGuess,
    profile,
    streak,
    isClaimed,
    pendingMilestones,
    dismissMilestone,
    error,
    notice,
    submit,
    next,
    retry,
    markClaimed,
    syncProfile,
  };
}

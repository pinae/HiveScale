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
  type Profile,
  type Round,
  fetchNextRound,
  startSession,
  submitGuess,
} from "../api/client";
import type { LevelProgress, RevealPayload } from "../api/reveal";
import type { GuessValue } from "../components/WaveSlider";

export type Phase = "booting" | "guessing" | "submitting" | "revealing" | "advancing" | "error";

export const DEFAULT_GUESS: GuessValue = { center: 50, widthLeft: 15, widthRight: 15 };

/** Running player progression surfaced in the header (xp/level/multiplier). */
export interface ProfileState {
  xp: number;
  level: number;
  multiplier: number;
  progress: LevelProgress | null;
}

type FailedAction = "boot" | "submit" | "next";

const profileFrom = (
  p: { xp: number; level: number; multiplier?: number; progress?: LevelProgress },
  progress: LevelProgress | null = p.progress ?? null,
): ProfileState => ({ xp: p.xp, level: p.level, multiplier: p.multiplier ?? 1, progress });

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
  error: string | null;
  submit: () => void;
  next: () => void;
  retry: () => void;
  /** Fold in the profile returned by a successful account claim (WP-11/12). */
  markClaimed: (profile: Profile) => void;
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
  });
  const [streak, setStreak] = useState(0);
  const [isClaimed, setIsClaimed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guessRef = useRef(guess);
  const roundRef = useRef<Round | null>(round);
  const preloaded = useRef<Round | null>(null);
  const failedAction = useRef<FailedAction | null>(null);
  useEffect(() => {
    guessRef.current = guess;
    roundRef.current = round;
  });

  const fail = useCallback((action: FailedAction, message: string) => {
    failedAction.current = action;
    setError(message);
    setPhase("error");
  }, []);

  const applyRound = useCallback((r: Round) => {
    setRound(r);
    setReveal(null);
    setSubmittedGuess(null);
    setGuess(DEFAULT_GUESS);
    setError(null);
    setPhase("guessing");
  }, []);

  // Starts at the initial "booting" phase; retry() re-enters it explicitly.
  const boot = useCallback(async () => {
    try {
      const { player } = await startSession();
      // A returning (claimed) player arrives with real xp/level and a claim flag.
      setProfile(profileFrom(player));
      setIsClaimed(player.is_claimed);
      applyRound(await fetchNextRound());
    } catch {
      fail("boot", "Couldn't reach the game. Check your connection.");
    }
  }, [applyRound, fail]);

  const markClaimed = useCallback((player: Profile) => {
    setProfile(profileFrom(player));
    setIsClaimed(player.is_claimed);
  }, []);

  const submit = useCallback(async () => {
    const current = roundRef.current;
    if (!current) return;
    const g = guessRef.current;
    setPhase("submitting");
    setError(null);
    try {
      const rev = await submitGuess({
        round_token: current.round_token,
        center: g.center,
        width_left: g.widthLeft,
        width_right: g.widthRight,
      });
      setReveal(rev);
      setSubmittedGuess(g);
      setProfile(profileFrom(rev.player, rev.progress ?? null));
      setStreak(rev.streak.hot);
      setPhase("revealing");
      // Preload the next round during the reveal (errors surface on Next).
      preloaded.current = null;
      fetchNextRound()
        .then((r) => {
          preloaded.current = r;
        })
        .catch(() => {
          preloaded.current = null;
        });
    } catch {
      fail("submit", "Couldn't submit your guess.");
    }
  }, [fail]);

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
      applyRound(await fetchNextRound());
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
    error,
    submit,
    next,
    retry,
    markClaimed,
  };
}

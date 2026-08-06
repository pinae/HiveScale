/**
 * The PvP match state machine (a Daily Wave, but against a friend).
 *
 * Phases: loading → waiting (for the opponent / the round barrier) → guessing →
 * revealing → … → done. The one thing this adds over `useDailyWave` is the
 * **barrier**: a slot's question only arrives once both players have marked
 * themselves ready, so both are timed from the same instant. `readyForPvpRound`
 * long-polls on the server; when it returns `waiting` we simply poll again,
 * which keeps the client trivial and survives a friend who wanders off.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type PvpMatchState,
  type PvpReveal,
  fetchPvpMatch,
  readyForPvpRound,
  submitPvpGuess,
} from "../api/client";
import type { GuessValue } from "../components/WaveSlider";
import { DEFAULT_GUESS } from "./useGameLoop";

export type PvpPhase =
  | "loading"
  | "waiting"
  | "guessing"
  | "submitting"
  | "revealing"
  | "done"
  | "error";

export interface PvpMatchLoop {
  phase: PvpPhase;
  match: PvpMatchState | null;
  guess: GuessValue;
  setGuess: (g: GuessValue) => void;
  reveal: PvpReveal | null;
  submittedGuess: GuessValue | null;
  error: string | null;
  submit: () => void;
  next: () => void;
  retry: () => void;
}

export function usePvpMatch(joinCode: string): PvpMatchLoop {
  const [phase, setPhase] = useState<PvpPhase>("loading");
  const [match, setMatch] = useState<PvpMatchState | null>(null);
  const [guess, setGuess] = useState<GuessValue>(DEFAULT_GUESS);
  const [reveal, setReveal] = useState<PvpReveal | null>(null);
  const [submittedGuess, setSubmittedGuess] = useState<GuessValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guessRef = useRef(guess);
  const matchRef = useRef<PvpMatchState | null>(null);
  // Bumped on unmount/retry so an in-flight long-poll loop stops touching state.
  const runRef = useRef(0);
  useEffect(() => {
    guessRef.current = guess;
    matchRef.current = match;
  });

  const applyState = useCallback((state: PvpMatchState) => {
    setMatch(state);
    matchRef.current = state;
    if (state.completed || state.next === null) {
      setPhase("done");
      return true;
    }
    return false;
  }, []);

  /** Mark ready and keep polling until the opponent shows up and the slot opens. */
  const awaitRound = useCallback(
    async (state: PvpMatchState) => {
      const run = runRef.current;
      setPhase("waiting");
      let index = state.next?.index ?? 0;
      // Loop: each call is a server-side long poll, so this is cheap.
      for (;;) {
        let result;
        try {
          result = await readyForPvpRound(joinCode, index);
        } catch {
          if (run !== runRef.current) return;
          setError("Lost the connection to your battle.");
          setPhase("error");
          return;
        }
        if (run !== runRef.current) return; // superseded (unmounted or retried)
        if (!result.waiting) {
          const next = result as PvpMatchState;
          setMatch(next);
          matchRef.current = next;
          if (next.completed || next.next === null) {
            setPhase("done");
          } else {
            setGuess(DEFAULT_GUESS);
            setReveal(null);
            setSubmittedGuess(null);
            setPhase("guessing");
          }
          return;
        }
        index = result.index ?? index;
      }
    },
    [joinCode],
  );

  const load = useCallback(async () => {
    const run = runRef.current;
    setPhase("loading");
    setError(null);
    try {
      const state = await fetchPvpMatch(joinCode);
      if (run !== runRef.current) return;
      if (applyState(state)) return;
      await awaitRound(state);
    } catch (err) {
      if (run !== runRef.current) return;
      setError(err instanceof Error && err.message ? err.message : "Couldn't load the battle.");
      setPhase("error");
    }
  }, [joinCode, applyState, awaitRound]);

  const submit = useCallback(async () => {
    const state = matchRef.current;
    const token = state?.next?.pvp_token;
    if (!state || !token) return;
    const g = guessRef.current;
    setPhase("submitting");
    setError(null);
    try {
      const result = await submitPvpGuess(joinCode, {
        pvp_token: token,
        center: g.center,
        width_left: g.widthLeft,
        width_right: g.widthRight,
      });
      setReveal(result);
      setSubmittedGuess(g);
      setMatch(result.match);
      matchRef.current = result.match;
      setPhase("revealing");
    } catch {
      setError("Couldn't submit your guess.");
      setPhase("error");
    }
  }, [joinCode]);

  /** Leave the reveal: either the match is over, or wait for the next barrier. */
  const next = useCallback(() => {
    const state = matchRef.current;
    if (!state) return;
    if (state.completed || state.next === null) {
      setPhase("done");
      return;
    }
    void awaitRound(state);
  }, [awaitRound]);

  const retry = useCallback(() => {
    runRef.current += 1; // abandon any in-flight poll before starting over
    void load();
  }, [load]);

  useEffect(() => {
    runRef.current += 1;
    // Data-loading effect; load() only touches state in its async continuation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      runRef.current += 1; // stop the poll loop from updating an unmounted tree
    };
  }, [load]);

  return {
    phase,
    match,
    guess,
    setGuess,
    reveal,
    submittedGuess,
    error,
    submit,
    next,
    retry,
  };
}

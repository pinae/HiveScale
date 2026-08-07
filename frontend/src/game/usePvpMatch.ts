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
  /** You've answered every round; the opponent hasn't finished theirs yet. */
  | "awaiting-result"
  | "done"
  | "error";

/** How often to re-check a finished-but-not-complete match for the result. */
export const RESULT_POLL_MS = 4000;

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

  /** Land on the right terminal phase, or return false if there's a round to play.
   *
   * Finishing your own rounds is *not* the end of the match: the result only
   * exists once the opponent has finished theirs too. Those two cases used to
   * collapse into "done", which left whoever finished first staring at a
   * "waiting…" screen forever — `awaiting-result` polls instead.
   */
  const applyState = useCallback((state: PvpMatchState) => {
    setMatch(state);
    matchRef.current = state;
    if (state.completed) {
      setPhase("done");
      return true;
    }
    if (state.next === null) {
      setPhase("awaiting-result");
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
          if (!applyState(next)) {
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
    [joinCode, applyState],
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

  /** Leave the reveal: to the result, to waiting for it, or to the next barrier. */
  const next = useCallback(() => {
    const state = matchRef.current;
    if (!state) return;
    if (state.completed) {
      setPhase("done");
      return;
    }
    if (state.next === null) {
      setPhase("awaiting-result");
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

  // You're done but your friend isn't: keep checking until the match completes,
  // then show the summary. Without this the player who finished first never sees
  // the result — the very case where they answered fastest.
  useEffect(() => {
    if (phase !== "awaiting-result") return;
    const run = runRef.current;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const state = await fetchPvpMatch(joinCode);
        if (run !== runRef.current) return;
        setMatch(state);
        matchRef.current = state;
        if (state.completed) {
          setPhase("done");
          return;
        }
      } catch {
        /* transient: just try again on the next tick */
      }
      if (run === runRef.current) timer = setTimeout(tick, RESULT_POLL_MS);
    };
    timer = setTimeout(tick, RESULT_POLL_MS);
    return () => clearTimeout(timer);
  }, [phase, joinCode]);

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

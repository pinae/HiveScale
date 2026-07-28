/**
 * The Daily Wave loop (WP-11, plan §2.2): play today's shared set slot by slot,
 * then reach a completed state that carries the shareable result.
 *
 * Phases: loading → guessing → revealing → (next) guessing … → done. Any failed
 * step drops into `error`, whose `retry` re-runs exactly what failed. It mirrors
 * the round loop but is bounded to the wave's fixed slots and ends in `done`.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type DailyWaveSlot,
  type DailyWaveState,
  fetchDailyWave,
  submitDailyWaveGuess,
} from "../api/client";
import type { RevealPayload } from "../api/reveal";
import { DEFAULT_GUESS } from "./useGameLoop";
import type { GuessValue } from "../components/WaveSlider";

export type WavePhase = "loading" | "guessing" | "revealing" | "done" | "error";

type FailedAction = "load" | "submit";

export interface DailyWaveLoop {
  phase: WavePhase;
  wave: DailyWaveState | null;
  /** The slot currently being answered (null unless guessing). */
  slot: DailyWaveSlot | null;
  guess: GuessValue;
  setGuess: (g: GuessValue) => void;
  reveal: RevealPayload | null;
  submittedGuess: GuessValue | null;
  error: string | null;
  submit: () => void;
  next: () => void;
  retry: () => void;
}

export function useDailyWave(): DailyWaveLoop {
  const [phase, setPhase] = useState<WavePhase>("loading");
  const [wave, setWave] = useState<DailyWaveState | null>(null);
  const [guess, setGuess] = useState<GuessValue>(DEFAULT_GUESS);
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [submittedGuess, setSubmittedGuess] = useState<GuessValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guessRef = useRef(guess);
  const waveRef = useRef<DailyWaveState | null>(wave);
  const failedAction = useRef<FailedAction | null>(null);
  useEffect(() => {
    guessRef.current = guess;
    waveRef.current = wave;
  });

  const fail = useCallback((action: FailedAction, message: string) => {
    failedAction.current = action;
    setError(message);
    setPhase("error");
  }, []);

  const applyWave = useCallback((state: DailyWaveState) => {
    setWave(state);
    setReveal(null);
    setSubmittedGuess(null);
    setGuess(DEFAULT_GUESS);
    setError(null);
    setPhase(state.completed || state.next === null ? "done" : "guessing");
  }, []);

  const load = useCallback(async () => {
    try {
      applyWave(await fetchDailyWave());
    } catch {
      fail("load", "Couldn't load today's Daily Wave.");
    }
  }, [applyWave, fail]);

  const submit = useCallback(async () => {
    const slot = waveRef.current?.next;
    if (!slot) return;
    const g = guessRef.current;
    setPhase("revealing");
    setError(null);
    try {
      const result = await submitDailyWaveGuess({
        wave_token: slot.wave_token,
        center: g.center,
        width_left: g.widthLeft,
        width_right: g.widthRight,
      });
      setReveal(result);
      setSubmittedGuess(g);
      setWave(result.wave);
    } catch {
      fail("submit", "Couldn't submit your Daily Wave guess.");
    }
  }, [fail]);

  const next = useCallback(() => {
    const state = waveRef.current;
    if (!state) return;
    if (state.completed || state.next === null) {
      setPhase("done");
      return;
    }
    setReveal(null);
    setSubmittedGuess(null);
    setGuess(DEFAULT_GUESS);
    setPhase("guessing");
  }, []);

  const retry = useCallback(() => {
    setError(null);
    if (failedAction.current === "submit") {
      setPhase("guessing");
      submit();
    } else {
      setPhase("loading");
      load();
    }
  }, [load, submit]);

  useEffect(() => {
    // Load today's wave on mount (the accepted data-loading use of an effect;
    // load() only sets state in its async continuation).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return {
    phase,
    wave,
    slot: phase === "guessing" ? (wave?.next ?? null) : null,
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

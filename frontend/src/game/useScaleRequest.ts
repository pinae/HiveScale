/**
 * The scale-request loop (plan §2.x, unlocked at level 15): once a day, after a
 * few rounds, invent a surprising new scale for a randomly chosen thing.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  type ScaleRequestResult,
  type ScaleRequestState,
  fetchScaleRequest,
  submitScaleRequest,
} from "../api/client";

export type ScalePhase = "loading" | "writing" | "submitting" | "unavailable" | "done" | "error";

export interface ScaleRequestLoop {
  phase: ScalePhase;
  prompt: ScaleRequestState | null;
  result: ScaleRequestResult | null;
  error: string | null;
  submit: (left: string, right: string) => void;
  retry: () => void;
}

export function useScaleRequest(): ScaleRequestLoop {
  const [phase, setPhase] = useState<ScalePhase>("loading");
  const [prompt, setPrompt] = useState<ScaleRequestState | null>(null);
  const [result, setResult] = useState<ScaleRequestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const promptRef = useRef<ScaleRequestState | null>(null);
  useEffect(() => {
    promptRef.current = prompt;
  });

  const load = useCallback(async () => {
    try {
      const state = await fetchScaleRequest();
      setPrompt(state);
      setError(null);
      setPhase(state.available ? "writing" : "unavailable");
    } catch {
      setError("Couldn't load today's scale prompt.");
      setPhase("error");
    }
  }, []);

  const submit = useCallback(async (left: string, right: string) => {
    const current = promptRef.current;
    if (!current?.scale_request_token || !left.trim() || !right.trim()) return;
    setPhase("submitting");
    setError(null);
    try {
      setResult(
        await submitScaleRequest({
          scale_request_token: current.scale_request_token,
          left: left.trim(),
          right: right.trim(),
        }),
      );
      setPhase("done");
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : "Couldn't file that scale.");
      setPhase("writing");
    }
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setPhase("loading");
    load();
  }, [load]);

  useEffect(() => {
    // Load today's prompt on mount (state set only in the async tail).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { phase, prompt, result, error, submit, retry };
}

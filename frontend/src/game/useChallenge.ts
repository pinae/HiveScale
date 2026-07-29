/**
 * The thing-challenge loop (plan §2.x, unlocked at level 10): deal two scales,
 * accept a ≤3-word thing that maxes the first and mins the second, bank a flat
 * bonus, then deal the next.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  type ChallengeDeal,
  type ChallengeResult,
  fetchChallenge,
  submitChallenge,
} from "../api/client";

export type ChallengePhase = "loading" | "writing" | "submitting" | "done" | "empty" | "error";

export interface ChallengeLoop {
  phase: ChallengePhase;
  deal: ChallengeDeal | null;
  lastResult: ChallengeResult | null;
  error: string | null;
  submit: (text: string) => void;
  again: () => void;
  retry: () => void;
}

export function useChallenge(onReward: (result: ChallengeResult) => void): ChallengeLoop {
  const [phase, setPhase] = useState<ChallengePhase>("loading");
  const [deal, setDeal] = useState<ChallengeDeal | null>(null);
  const [lastResult, setLastResult] = useState<ChallengeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dealRef = useRef<ChallengeDeal | null>(null);
  const onRewardRef = useRef(onReward);
  useEffect(() => {
    dealRef.current = deal;
    onRewardRef.current = onReward;
  });

  const load = useCallback(async () => {
    try {
      setDeal(await fetchChallenge());
      setError(null);
      setPhase("writing");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setPhase("empty");
      } else {
        setError("Couldn't load a challenge.");
        setPhase("error");
      }
    }
  }, []);

  const submit = useCallback(async (text: string) => {
    const current = dealRef.current;
    if (!current || !text.trim()) return;
    setPhase("submitting");
    setError(null);
    try {
      const result = await submitChallenge({ challenge_token: current.challenge_token, text: text.trim() });
      setLastResult(result);
      onRewardRef.current(result);
      setPhase("done");
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : "Couldn't submit that.");
      setPhase("writing");
    }
  }, []);

  const again = useCallback(() => {
    setPhase("loading");
    load();
  }, [load]);

  const retry = useCallback(() => {
    setError(null);
    setPhase("loading");
    load();
  }, [load]);

  useEffect(() => {
    // Deal the first challenge on mount (state set only in the async tail).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { phase, deal, lastResult, error, submit, again, retry };
}

/**
 * The pairing-curation loop (plan §2.x, unlocked at level 5): fetch a thing+scale
 * to judge, cast a fun/interesting/boring/weird verdict, advance to the next.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  type VoteCandidate,
  type VoteChoice,
  type VoteResult,
  fetchVoteCandidate,
  submitVote,
} from "../api/client";

export type VotePhase = "loading" | "voting" | "submitting" | "empty" | "error";

export interface VotingLoop {
  phase: VotePhase;
  candidate: VoteCandidate | null;
  lastOutcome: VoteResult["outcome"] | null;
  error: string | null;
  vote: (choice: VoteChoice) => void;
  retry: () => void;
}

export function useVoting(): VotingLoop {
  const [phase, setPhase] = useState<VotePhase>("loading");
  const [candidate, setCandidate] = useState<VoteCandidate | null>(null);
  const [lastOutcome, setLastOutcome] = useState<VoteResult["outcome"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const candidateRef = useRef<VoteCandidate | null>(null);
  useEffect(() => {
    candidateRef.current = candidate;
  });

  const load = useCallback(async () => {
    try {
      const next = await fetchVoteCandidate();
      setCandidate(next);
      setError(null);
      setPhase("voting");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setPhase("empty");
      } else {
        setError("Couldn't load a pairing to vote on.");
        setPhase("error");
      }
    }
  }, []);

  const vote = useCallback(
    async (choice: VoteChoice) => {
      const current = candidateRef.current;
      if (!current) return;
      setPhase("submitting");
      setError(null);
      try {
        const result = await submitVote({
          thing_id: current.thing.id,
          scale_id: current.scale.id,
          choice,
        });
        setLastOutcome(result.outcome);
        await load();
      } catch {
        setError("Couldn't record your vote.");
        setPhase("error");
      }
    },
    [load],
  );

  const retry = useCallback(() => {
    setError(null);
    setPhase("loading");
    load();
  }, [load]);

  useEffect(() => {
    // Load the first candidate on mount (state only set in the async tail).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { phase, candidate, lastOutcome, error, vote, retry };
}

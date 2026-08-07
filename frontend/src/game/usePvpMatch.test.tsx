/**
 * The match loop's terminal states.
 *
 * Finishing your own rounds is not the end of a match — the result only exists
 * once the opponent finishes theirs. The hook must therefore distinguish
 * `awaiting-result` (poll until it completes) from `done` (show the summary);
 * collapsing them left whoever finished first on a dead screen.
 *
 * The client module is mocked so there's no real network, which lets fake timers
 * drive the poll interval instead of the suite really sleeping through it.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RESULT_POLL_MS, usePvpMatch } from "./usePvpMatch";
import * as client from "../api/client";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    fetchPvpMatch: vi.fn(),
    readyForPvpRound: vi.fn(),
    submitPvpGuess: vi.fn(),
  };
});

const entry = (index: number) => ({
  index,
  points: 700,
  means_match: 0.7,
  belief_match: 0.6,
  response_ms: 4000,
  speed_bonus: false,
});

const base = {
  join_code: "abc",
  total: 10,
  opponent_joined: true,
  speed_bonus_next: false,
  next: null,
};

/** You've answered everything; your friend still has one to go. */
const youDone = {
  ...base,
  you: { answered: 10, score: 7000, entries: [entry(0)] },
  opponent: { answered: 9, score: 3600, entries: [entry(0)] },
  completed: false,
  result: null,
} as unknown as client.PvpMatchState;

const bothDone = {
  ...base,
  you: { answered: 10, score: 7000, entries: [entry(0)] },
  opponent: { answered: 10, score: 7400, entries: [entry(0), entry(1)] },
  completed: true,
  result: {
    winner: "opponent" as const,
    margin: 0.4,
    score_margin: 400,
    you_end: { x: 1.4, y: 1.6 },
    opponent_end: { x: 1.6, y: 1.8 },
  },
} as unknown as client.PvpMatchState;

beforeEach(() => {
  vi.mocked(client.fetchPvpMatch).mockReset();
  // Fake timers must be installed *before* the hook schedules its poll, so they
  // are on for the whole test; `settle` then drives both timers and promises.
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Advance the clock and flush the promises that resolve because of it. */
const settle = (ms = 0) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms);
});

describe("usePvpMatch — finishing", () => {
  it("waits for the result when you finish first, then shows it", async () => {
    vi.mocked(client.fetchPvpMatch)
      .mockResolvedValueOnce(youDone) // initial load: friend still playing
      .mockResolvedValue(bothDone); // by the next poll they're done

    const { result } = renderHook(() => usePvpMatch("abc"));
    await settle();

    // Not "done" — there is no result yet, so it must keep looking.
    expect(result.current.phase).toBe("awaiting-result");

    await settle(RESULT_POLL_MS + 10);

    expect(result.current.phase).toBe("done");
    // The loser who finished first still gets the full summary.
    expect(result.current.match?.result?.winner).toBe("opponent");
    expect(client.fetchPvpMatch).toHaveBeenCalledTimes(2);
  });

  it("goes straight to the result when the match is already complete", async () => {
    vi.mocked(client.fetchPvpMatch).mockResolvedValue(bothDone);
    const { result } = renderHook(() => usePvpMatch("abc"));
    await settle();
    expect(result.current.phase).toBe("done");
    expect(result.current.match?.result).not.toBeNull();
  });

  it("keeps polling while the opponent is still playing", async () => {
    vi.mocked(client.fetchPvpMatch).mockResolvedValue(youDone); // never completes
    const { result } = renderHook(() => usePvpMatch("abc"));
    await settle();
    expect(result.current.phase).toBe("awaiting-result");

    await settle(RESULT_POLL_MS * 3 + 30);
    expect(result.current.phase).toBe("awaiting-result");
    expect(vi.mocked(client.fetchPvpMatch).mock.calls.length).toBeGreaterThan(2);
  });

  it("survives a hiccup while polling and recovers on a later tick", async () => {
    vi.mocked(client.fetchPvpMatch)
      .mockResolvedValueOnce(youDone)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(bothDone);

    const { result } = renderHook(() => usePvpMatch("abc"));
    await settle();
    expect(result.current.phase).toBe("awaiting-result");

    await settle(RESULT_POLL_MS * 2 + 20);
    // A failed poll is not fatal — it just tries again.
    expect(result.current.phase).toBe("done");
  });

  it("stops polling once unmounted", async () => {
    vi.mocked(client.fetchPvpMatch).mockResolvedValue(youDone);
    const { result, unmount } = renderHook(() => usePvpMatch("abc"));
    await settle();
    expect(result.current.phase).toBe("awaiting-result");

    const before = vi.mocked(client.fetchPvpMatch).mock.calls.length;
    unmount();
    await settle(RESULT_POLL_MS * 3);
    expect(vi.mocked(client.fetchPvpMatch).mock.calls.length).toBe(before);
  });
});

/**
 * Thin fetch client for the round loop (WP-10). All calls are same-origin
 * (`/api/...`), proxied to Django in dev. Responses are typed against the
 * backend contract; non-2xx responses raise {@link ApiError}.
 */
import type { RevealPayload } from "./reveal";

export interface Round {
  pairing_id: number;
  thing: { text: string };
  scale: { left: string; right: string };
  round_token: string;
}

export interface Profile {
  level: number;
  xp: number;
  is_claimed: boolean;
}

export interface Stats {
  archetype: { name: string; blurb: string };
  calibration: { n: number; hit_rate: number; mean_width: number };
  streaks: { hot: number; daily: number; freezes: number };
  xp: number;
  level: number;
}

export interface GuessInput {
  round_token: string;
  center: number;
  width_left: number;
  width_right: number;
}

export class ApiError extends Error {
  constructor(readonly status: number, message?: string) {
    super(message ?? `Request failed (${status})`);
    this.name = "ApiError";
  }
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: string | undefined;
    try {
      detail = ((await res.json()) as { detail?: string })?.detail;
    } catch {
      /* non-JSON error body — fall back to the status-only message */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

const jsonPost = (url: string, body: unknown): Promise<Response> =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export async function startSession(): Promise<{ player: Profile; created: boolean }> {
  return readJson(await fetch("/api/session/", { method: "POST" }));
}

export interface ClaimRequestResult {
  detail: string;
  /** Present only in dev/test ("echo" delivery); prod emails the link instead. */
  claim_token?: string;
}

export interface ClaimConfirmResult {
  player: Profile;
  /** True when the email already had an account and the two were merged. */
  merged: boolean;
}

/** Start an account claim: ask the backend to issue a magic link for `email`. */
export async function requestClaim(email: string): Promise<ClaimRequestResult> {
  return readJson(await jsonPost("/api/session/claim/request/", { email }));
}

/** Finish a claim: exchange a magic-link token for the (possibly merged) profile. */
export async function confirmClaim(claimToken: string): Promise<ClaimConfirmResult> {
  return readJson(await jsonPost("/api/session/claim/confirm/", { claim_token: claimToken }));
}

/** One blind slot of the Daily Wave (identity only — no distribution). */
export interface DailyWaveSlot {
  index: number;
  pairing_id: number;
  thing: { text: string };
  scale: { left: string; right: string };
  wave_token: string;
}

/** The player's progress through today's Daily Wave (plan §2.2). */
export interface DailyWaveState {
  date: string;
  total: number;
  answered: number;
  completed: boolean;
  /** Result emoji for each answered slot, in order. */
  results: string[];
  score: number;
  next: DailyWaveSlot | null;
  daily_streak: number;
  /** The shareable emoji summary, present once the wave is completed. */
  share_string: string | null;
}

/** A Daily Wave guess reveals the round *and* carries the updated wave progress. */
export type DailyWaveReveal = RevealPayload & { wave: DailyWaveState };

export async function fetchDailyWave(): Promise<DailyWaveState> {
  return readJson(await fetch("/api/daily-wave/"));
}

export async function submitDailyWaveGuess(input: {
  wave_token: string;
  center: number;
  width_left: number;
  width_right: number;
}): Promise<DailyWaveReveal> {
  return readJson(await jsonPost("/api/daily-wave/guess/", input));
}

export async function fetchNextRound(): Promise<Round> {
  return readJson(await fetch("/api/round/next/"));
}

export async function fetchStats(): Promise<Stats> {
  return readJson(await fetch("/api/me/stats/"));
}

export async function submitGuess(input: GuessInput): Promise<RevealPayload> {
  return readJson(
    await fetch("/api/round/guess/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

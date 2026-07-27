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
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

export async function startSession(): Promise<{ player: Profile; created: boolean }> {
  return readJson(await fetch("/api/session/", { method: "POST" }));
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

/**
 * Thin fetch client for the round loop (WP-10). All calls are same-origin
 * (`/api/...`), proxied to Django in dev. Responses are typed against the
 * backend contract; non-2xx responses raise {@link ApiError}.
 */
import type { LevelProgress, RevealPayload, Unlocks } from "./reveal";

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
  multiplier?: number;
  progress?: LevelProgress;
  unlocks?: Unlocks;
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

export type VoteChoice = "fun" | "interesting" | "boring" | "weird";

/** A thing+scale to judge — a fresh candidate combo or an existing pairing. */
export interface VoteCandidate {
  thing: { id: number; text: string };
  scale: { id: number; left: string; right: string };
  pairing_id: number | null;
  existing: boolean;
}

/** Outcome of a vote: a candidate promoted, retired, or just recorded. */
export interface VoteResult {
  outcome: "added" | "noted" | "recorded" | "retired";
  pairing_id?: number;
}

export async function fetchVoteCandidate(): Promise<VoteCandidate> {
  return readJson(await fetch("/api/vote/next/"));
}

/** A dealt thing challenge: two scales to satisfy, plus a signed token. */
export interface ChallengeDeal {
  first_scale: { id: number; left: string; right: string };
  second_scale: { id: number; left: string; right: string };
  max_words: number;
  reward_xp: number;
  challenge_token: string;
}

/** Result of a completed challenge — the new thing plus the updated profile. */
export interface ChallengeResult {
  thing_id: number;
  text: string;
  xp_awarded: number;
  player: { xp: number; level: number; multiplier: number };
  progress: LevelProgress;
  unlocks: Unlocks;
}

export async function fetchChallenge(): Promise<ChallengeDeal> {
  return readJson(await fetch("/api/challenge/next/"));
}

export async function submitChallenge(input: {
  challenge_token: string;
  text: string;
}): Promise<ChallengeResult> {
  return readJson(await jsonPost("/api/challenge/", input));
}

/** Today's scale prompt (or why it isn't available yet). */
export interface ScaleRequestState {
  available: boolean;
  reason?: string;
  thing?: { id: number; text: string };
  examples?: { left: string; right: string }[];
  scale_request_token?: string;
}

export interface ScaleRequestResult {
  scale_id: number;
  left: string;
  right: string;
  pairing_id: number;
}

export async function fetchScaleRequest(): Promise<ScaleRequestState> {
  return readJson(await fetch("/api/scale-request/"));
}

export async function submitScaleRequest(input: {
  scale_request_token: string;
  left: string;
  right: string;
}): Promise<ScaleRequestResult> {
  return readJson(await jsonPost("/api/scale-request/submit/", input));
}

export async function submitVote(input: {
  thing_id: number;
  scale_id: number;
  choice: VoteChoice;
}): Promise<VoteResult> {
  return readJson(await jsonPost("/api/vote/", input));
}

/**
 * Deal the next round. `exclude` is the client's recently-seen pairing ids
 * (the last SEEN_WINDOW, tracked in memory) so the backend can skip them without
 * storing per-player history — see the round scheduler.
 */
export async function fetchNextRound(opts: { exclude?: number[] } = {}): Promise<Round> {
  const params = new URLSearchParams();
  if (opts.exclude && opts.exclude.length > 0) {
    params.set("exclude", opts.exclude.join(","));
  }
  const query = params.toString();
  return readJson(await fetch(`/api/round/next/${query ? `?${query}` : ""}`));
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

// --- PvP matches (head-to-head wave against a friend) ---------------------

/** One player's answered round within a match — also the diagram's vectors. */
export interface PvpEntry {
  index: number;
  points: number;
  means_match: number;
  belief_match: number;
  response_ms: number;
  speed_bonus: boolean;
}

export interface PvpSide {
  answered: number;
  score: number;
  entries: PvpEntry[];
}

/** The next slot. Blind — thing/scale only appear once both players are ready. */
export interface PvpNext {
  index: number;
  started: boolean;
  opponent_ready: boolean;
  pairing_id?: number;
  thing?: { text: string };
  scale?: { left: string; right: string };
  pvp_token?: string;
}

export interface PvpResultSummary {
  winner: "you" | "opponent" | "tie";
  /** How much further the winner's arrow chain reached toward the corner. */
  margin: number;
  score_margin: number;
  you_end: { x: number; y: number };
  opponent_end: { x: number; y: number };
}

export interface PvpMatchState {
  join_code: string;
  total: number;
  opponent_joined: boolean;
  you: PvpSide;
  opponent: PvpSide;
  /** Whether the round you're about to play is already doubled. */
  speed_bonus_next: boolean;
  next: PvpNext | null;
  completed: boolean;
  result: PvpResultSummary | null;
}

/** A ready-poll either times out (waiting) or hands back the released round. */
export type PvpReadyResult = ({ waiting: true; index: number } & Partial<PvpMatchState>) |
  ({ waiting: false; index: number } & PvpMatchState);

/** A PvP guess reveals the round *and* carries the updated match state. */
export type PvpReveal = RevealPayload & { speed_bonus: boolean; match: PvpMatchState };

export interface PvpCaptcha {
  captcha_token: string;
  thing: { text: string };
  scale: { left: string; right: string };
}

export interface PvpStartResult {
  join_code: string;
  link: string;
  invited: boolean;
  detail?: string;
}

/** Deal the anti-bot round a challenger must play before we'll email a friend. */
export async function fetchPvpCaptcha(): Promise<PvpCaptcha> {
  return readJson(await fetch("/api/pvp/captcha/"));
}

export interface PvpStartInput {
  mode: "link" | "email";
  email?: string;
  captcha_token?: string;
  center?: number;
  width_left?: number;
  width_right?: number;
  /** Sampled pointer movement `[x, y, t]`, so the backend can tell a hand from a script. */
  pointer_path?: number[][];
}

export async function startPvpMatch(input: PvpStartInput): Promise<PvpStartResult> {
  return readJson(await jsonPost("/api/pvp/start/", input));
}

/** Read a match — and join it, if this is the first time you've opened the link. */
export async function fetchPvpMatch(joinCode: string): Promise<PvpMatchState> {
  return readJson(await fetch(`/api/pvp/${encodeURIComponent(joinCode)}/`));
}

/** Mark ready for a slot and long-poll until the opponent is ready too. */
export async function readyForPvpRound(
  joinCode: string,
  index: number,
): Promise<PvpReadyResult> {
  return readJson(await jsonPost(`/api/pvp/${encodeURIComponent(joinCode)}/ready/`, { index }));
}

export async function submitPvpGuess(
  joinCode: string,
  input: { pvp_token: string; center: number; width_left: number; width_right: number },
): Promise<PvpReveal> {
  return readJson(await jsonPost(`/api/pvp/${encodeURIComponent(joinCode)}/guess/`, input));
}

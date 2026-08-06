/**
 * Response contracts for POST /api/round/guess/ (WP-06), consumed by the reveal
 * UI. Field names mirror the backend JSON exactly (snake_case) so payloads map
 * straight onto these types.
 */

export interface CrowdStats {
  /** Distribution of players' *mean* placements — the reveal's bar chart. */
  histogram: number[];
  /** Sum of every player's full split-normal guess — the reveal's overlaid curve. */
  belief_histogram: number[];
  median: number;
  q25: number;
  q75: number;
  n: number;
}

export interface ScoreBreakdown {
  total: number;
  /** Overlap (0-1) of the guess bell with the crowd's mean placements. */
  means_match: number;
  /** Overlap (0-1) of the guess bell with the crowd's summed beliefs. */
  belief_match: number;
  /** Whether either component cleared the good-match threshold (keeps the multiplier). */
  good_match: boolean;
  /** The 0-1 bar a match must clear to keep the streak/multiplier (for the reveal copy). */
  good_match_threshold?: number;
}

export interface AiEstimate {
  provisional: boolean;
  median: number;
  q25: number;
  q75: number;
  histogram: number[];
}

export interface PlayerState {
  xp: number;
  level: number;
  /** Calibration XP multiplier ×1–×10 (present once the progression ships). */
  multiplier?: number;
}

/** Position within the current level, for a progress bar (plan progression). */
export interface LevelProgress {
  level: number;
  xp: number;
  into_level: number;
  level_span: number;
  next_level_xp: number;
}

/** Level-gated features the player has unlocked. */
export interface Unlocks {
  daily_wave: boolean;
  /** PvP matches — a head-to-head wave against a friend. */
  multiplayer: boolean;
  vote: boolean;
  challenge: boolean;
  scale: boolean;
}

export interface HumanReveal {
  source: "human";
  counted: boolean;
  score: ScoreBreakdown;
  crowd: CrowdStats;
  percentile: number;
  bimodal: boolean;
  streak: { hot: number; daily?: number };
  player: PlayerState;
  progress?: LevelProgress;
  unlocks?: Unlocks;
}

export interface PioneerReveal {
  source: "pioneer";
  counted: boolean;
  pioneer_bonus: number;
  ai_estimate: AiEstimate | null;
  streak: { hot: number; daily?: number };
  player: PlayerState;
  progress?: LevelProgress;
  unlocks?: Unlocks;
}

export type RevealPayload = HumanReveal | PioneerReveal;

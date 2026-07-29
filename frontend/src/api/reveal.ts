/**
 * Response contracts for POST /api/round/guess/ (WP-06), consumed by the reveal
 * UI. Field names mirror the backend JSON exactly (snake_case) so payloads map
 * straight onto these types.
 */

export interface CrowdStats {
  histogram: number[];
  median: number;
  q25: number;
  q75: number;
  n: number;
}

export interface ScoreBreakdown {
  total: number;
  distance_points: number;
  calibration_points: number;
  covered_fraction: number;
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

/** Level-gated contribution features the player has unlocked. */
export interface Unlocks {
  vote: boolean;
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

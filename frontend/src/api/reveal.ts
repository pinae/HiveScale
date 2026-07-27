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
}

export interface HumanReveal {
  source: "human";
  counted: boolean;
  score: ScoreBreakdown;
  crowd: CrowdStats;
  percentile: number;
  bimodal: boolean;
  streak: { hot: number };
  player: PlayerState;
}

export interface PioneerReveal {
  source: "pioneer";
  counted: boolean;
  pioneer_bonus: number;
  ai_estimate: AiEstimate | null;
  streak: { hot: number };
  player: PlayerState;
}

export type RevealPayload = HumanReveal | PioneerReveal;

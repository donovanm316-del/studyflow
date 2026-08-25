/**
 * All tunable numbers the scheduling engine uses, in one place, with the reasoning behind
 * each one written down. Nothing in this module is randomized — changing a value here changes
 * scheduling behavior predictably and is the intended way to tune the engine.
 */
import type {
  AssignmentWeight,
  BreakPreference,
  CourseRigor,
  DeadlineStrictness,
  FreeTimePriority,
  WorkloadTolerance,
  WorkType,
} from "@/types/models";

/**
 * Relative importance of each factor in the final priority score (Part 3 / Part 15).
 * All factor scores are normalized to 0–1 before these weights are applied, so the
 * weights below sum to 1 and can be read as "percent of the final score."
 */
export const DEFAULT_PRIORITY_WEIGHTS = {
  weight: 0.22, // assignment weight (low/medium/high)
  urgency: 0.28, // how close the due date is
  strictness: 0.2, // hard vs. important vs. flexible vs. target
  workload: 0.12, // how much estimated work remains — heavier items need an earlier start
  type: 0.08, // assignment type (tests/projects front-load more than routine homework)
  overdue: 0.1, // flat boost for anything already overdue
} as const;

export const ASSIGNMENT_WEIGHT_SCORE: Record<AssignmentWeight, number> = {
  low: 0.25,
  medium: 0.6,
  high: 1,
};

export const DEADLINE_STRICTNESS_SCORE: Record<DeadlineStrictness, number> = {
  hard: 1,
  important: 0.7,
  flexible: 0.4,
  target: 0.3,
};

/** How much a work type front-loads relative to routine homework (tests/projects need lead time). */
export const WORK_TYPE_SCORE: Record<WorkType, number> = {
  homework: 0.4,
  reading: 0.3,
  "study-session": 0.4,
  "quiz-prep": 0.55,
  "test-prep": 0.75,
  essay: 0.7,
  project: 0.8,
  "long-term": 0.85,
};

/** Work types that default to being splittable across multiple sessions (Part 4 / Part 5). */
export const DEFAULT_SPLITTABLE_WORK_TYPES: ReadonlySet<WorkType> = new Set([
  "project",
  "essay",
  "long-term",
  "test-prep",
]);

/** Urgency reaches its maximum at 0 days out and decays to ~0 by this many days out. */
export const URGENCY_HORIZON_DAYS = 10;

/**
 * Items due within this many days get first access to shared daily capacity, ahead of anything
 * with a higher raw priority score but more slack. Without this, a big, high-weight item due in
 * several days can legitimately out-score a tiny item due tomorrow and greedily consume the
 * shared day-by-day capacity ledger first — leaving the tiny, nearly-inflexible item stranded
 * with nowhere left to go. This is exactly the failure mode Part 3 of the spec calls out
 * ("should NOT automatically spend all available time on [the sooner, lighter item]... while
 * ensuring [it] is completed before its deadline") — protecting near-term deadlines first is
 * what keeps that guarantee true even though the bulk of the day's attention still goes to
 * whatever scores highest afterward.
 */
export const URGENT_PROTECTION_HORIZON_DAYS = 2;

/**
 * How much more than an even day-split a single item may claim per day under "early"/"adaptive"
 * work style (Part 9: "early" = "complete work well before deadlines", not "complete work
 * instantly"). Without this, an item with enough remaining days and daily capacity gets crammed
 * entirely into day one — which technically finishes early but ignores every other day available
 * to spread across, and can crowd out other items sharing that first day. 1.5 still lets "early"
 * finish ahead of a "consistent" spread (which uses exactly 1x the even split) while capping how
 * lopsided a single day can get.
 */
export const EARLY_FRONT_LOAD_FACTOR = 1.5;

/**
 * Baseline daily workload target in minutes, before rigor/free-time-priority/behind-schedule
 * adjustments, by workload tolerance (Part 9 / Part 10). These are *soft targets*, not hard
 * caps and not guarantees — actual available time and deadlines still bound the real schedule.
 */
export const BASE_DAILY_CAPACITY_MINUTES: Record<Exclude<WorkloadTolerance, "adaptive">, number> = {
  light: 75,
  moderate: 135,
  heavy: 210,
};
/** "adaptive" starts from the moderate baseline and lets rigor/behind-schedule context move it. */
export const ADAPTIVE_BASE_DAILY_CAPACITY_MINUTES = BASE_DAILY_CAPACITY_MINUTES.moderate;

/** Absolute ceiling on the soft daily target, even when behind schedule (Part 9: "prevent unreasonable schedules"). */
export const MAX_DAILY_CAPACITY_MINUTES: Record<Exclude<WorkloadTolerance, "adaptive">, number> = {
  light: 150,
  moderate: 240,
  heavy: 330,
};
export const ADAPTIVE_MAX_DAILY_CAPACITY_MINUTES = MAX_DAILY_CAPACITY_MINUTES.moderate;

/** Course rigor nudges the capacity target — it never invents work, only raises/lowers the ceiling. */
export const RIGOR_CAPACITY_MULTIPLIER: Record<CourseRigor, number> = {
  grade_level: 1,
  honors: 1.08,
  advanced: 1.1,
  ap: 1.18,
  ib: 1.18,
  college_level: 1.22,
};

export const FREE_TIME_PRIORITY_MULTIPLIER: Record<FreeTimePriority, number> = {
  high: 0.8,
  medium: 1,
  low: 1.15,
};

/** Applied to the soft daily target when the student has overdue work or unmet hard deadlines. */
export const BEHIND_SCHEDULE_MULTIPLIER = 1.4;

/** Work-session length bounds (minutes) by break preference (Part 8). */
export const SESSION_LENGTH_BOUNDS: Record<BreakPreference, { min: number; max: number }> = {
  frequent: { min: 20, max: 40 },
  balanced: { min: 35, max: 60 },
  minimal: { min: 45, max: 90 },
};

/** Break length (minutes) inserted between consecutive sessions when autoBreaks is on. */
export const BREAK_LENGTH_MINUTES: Record<BreakPreference, number> = {
  frequent: 10,
  balanced: 8,
  minimal: 5,
};

/** Never schedule a work chunk shorter than this — a 3-minute block isn't meaningful (Part 5). */
export const MIN_CHUNK_MINUTES = 10;

/** How far past the planning range the engine will look for optional work-ahead suggestions (Part 11). */
export const WORK_AHEAD_HORIZON_DAYS = 14;

/**
 * Deterministic (non-ML) response to repeated schedule feedback (Phase 2.5, Part 11). Only the
 * most recent `FEEDBACK_STREAK_LENGTH` responses are considered, and only if they unanimously
 * agree — a single "just right" (or a mixed streak) resets the adjustment to neutral, so this
 * self-corrects quickly rather than accumulating forever. The multipliers are deliberately mild
 * and, combined with the existing per-tolerance MAX_DAILY_CAPACITY_MINUTES ceiling, can never
 * push the schedule into an unreasonable workload — "repeatedly says too heavy" nudges the
 * target down, it doesn't remove the ceiling.
 */
export const FEEDBACK_STREAK_LENGTH = 2;
export const FEEDBACK_ADJUSTMENT_DECREASE = 0.85;
export const FEEDBACK_ADJUSTMENT_INCREASE = 1.15;

/**
 * Thresholds for `calculateWorkloadStatus` (Phase 3A, Part 6), expressed as
 * estimatedRemainingMinutes / availableMinutes. Chosen so the spec's own worked example
 * (7h20m remaining, 9h available → ratio ≈0.81) lands on "on-track" ("could reasonably be ON
 * TRACK") while (7h20m remaining, 4h30m available → ratio ≈1.63) lands on "at-risk".
 */
export const WORKLOAD_STATUS_ON_TRACK_MAX_RATIO = 0.85;
export const WORKLOAD_STATUS_GETTING_TIGHT_MAX_RATIO = 1.0;

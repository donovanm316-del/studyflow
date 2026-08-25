/**
 * Daily workload capacity (Part 10). This is a *soft target* in minutes for how much work the
 * engine will try to place on a given day — not a hard cap (a hard deadline can still push past
 * it, up to the available free time) and not a promise that this much work exists to schedule.
 *
 * Deliberately NOT "AP = 4 hours every day": rigor only nudges the target, it never manufactures
 * work on days that don't need it (see `generateSchedule`'s caught-up handling in `scheduler.ts`).
 */
import {
  ADAPTIVE_BASE_DAILY_CAPACITY_MINUTES,
  ADAPTIVE_MAX_DAILY_CAPACITY_MINUTES,
  BASE_DAILY_CAPACITY_MINUTES,
  BEHIND_SCHEDULE_MULTIPLIER,
  FEEDBACK_ADJUSTMENT_DECREASE,
  FEEDBACK_ADJUSTMENT_INCREASE,
  FEEDBACK_STREAK_LENGTH,
  FREE_TIME_PRIORITY_MULTIPLIER,
  MAX_DAILY_CAPACITY_MINUTES,
  RIGOR_CAPACITY_MULTIPLIER,
} from "./constants";
import type { BreakPreference, CourseRigor, FreeTimePriority, PlanningProfile, ScheduleFeedback } from "@/types/models";

export interface DailyCapacityContext {
  /** Rigor of the courses with work actually due soon — an empty array leaves the target unchanged. */
  relevantRigors: CourseRigor[];
  /** Whether the student currently has overdue work or a hard deadline that needs extra time. */
  isBehind: boolean;
  /** Multiplier from `calculateFeedbackAdjustment` — defaults to 1 (no adjustment) when omitted. */
  feedbackAdjustment?: number;
}

export function calculateDailyCapacity(profile: PlanningProfile, context: DailyCapacityContext): number {
  const tolerance = profile.workloadTolerance;
  const base =
    tolerance === "adaptive" ? ADAPTIVE_BASE_DAILY_CAPACITY_MINUTES : BASE_DAILY_CAPACITY_MINUTES[tolerance];
  const max =
    tolerance === "adaptive" ? ADAPTIVE_MAX_DAILY_CAPACITY_MINUTES : MAX_DAILY_CAPACITY_MINUTES[tolerance];

  const rigorMultiplier = averageRigorMultiplier(context.relevantRigors);
  const freeTimeMultiplier = FREE_TIME_PRIORITY_MULTIPLIER[profile.freeTimePriority];
  const behindMultiplier = context.isBehind ? BEHIND_SCHEDULE_MULTIPLIER : 1;
  const feedbackMultiplier = context.feedbackAdjustment ?? 1;

  const target = base * rigorMultiplier * freeTimeMultiplier * behindMultiplier * feedbackMultiplier;
  // The tolerance-based ceiling always wins, even when feedback would otherwise push higher —
  // feedback can make a schedule lighter or heavier within a student's own stated tolerance, but
  // never override it.
  return Math.min(max, Math.max(20, Math.round(target)));
}

function averageRigorMultiplier(rigors: CourseRigor[]): number {
  if (rigors.length === 0) return 1;
  const sum = rigors.reduce((total, rigor) => total + RIGOR_CAPACITY_MULTIPLIER[rigor], 0);
  return sum / rigors.length;
}

/**
 * Turns recent "how did this schedule feel?" feedback into a bounded capacity multiplier
 * (Phase 2.5, Part 11). Deterministic and simple by design — no ML, no unbounded drift: only the
 * most recent `FEEDBACK_STREAK_LENGTH` responses matter, and they must unanimously agree.
 */
export function calculateFeedbackAdjustment(feedbackHistory: ScheduleFeedback[]): number {
  if (feedbackHistory.length < FEEDBACK_STREAK_LENGTH) return 1;

  const mostRecentFirst = [...feedbackHistory].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const recent = mostRecentFirst.slice(0, FEEDBACK_STREAK_LENGTH);

  if (recent.every((f) => f.workloadFeeling === "too-heavy")) return FEEDBACK_ADJUSTMENT_DECREASE;
  if (recent.every((f) => f.workloadFeeling === "too-light")) return FEEDBACK_ADJUSTMENT_INCREASE;
  return 1;
}

const BREAK_PREFERENCE_ORDER: BreakPreference[] = ["frequent", "balanced", "minimal"];
const FREE_TIME_PRIORITY_ORDER: FreeTimePriority[] = ["low", "medium", "high"];

/**
 * Same bounded, unanimous-streak-of-2 pattern as `calculateFeedbackAdjustment`, applied to the
 * "how do the breaks feel?" check-in question (Phase 3A, Part 9) instead of daily capacity.
 * Returns the profile's current value (no change) unless the two most recent responses that
 * answered this question agree. One step at a time, clamped at the ends of the scale — this can
 * never jump straight from "frequent" to "minimal" on a single streak.
 */
export function calculateBreakPreferenceAdjustment(
  feedbackHistory: ScheduleFeedback[],
  current: BreakPreference
): BreakPreference {
  const answered = feedbackHistory
    .filter((f) => f.breaksFeeling != null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (answered.length < FEEDBACK_STREAK_LENGTH) return current;

  const recent = answered.slice(0, FEEDBACK_STREAK_LENGTH);
  const index = BREAK_PREFERENCE_ORDER.indexOf(current);

  if (recent.every((f) => f.breaksFeeling === "too-many")) {
    return BREAK_PREFERENCE_ORDER[Math.min(BREAK_PREFERENCE_ORDER.length - 1, index + 1)];
  }
  if (recent.every((f) => f.breaksFeeling === "too-few")) {
    return BREAK_PREFERENCE_ORDER[Math.max(0, index - 1)];
  }
  return current;
}

/** Same pattern as `calculateBreakPreferenceAdjustment`, for the "how much free time?" question. */
export function calculateFreeTimePriorityAdjustment(
  feedbackHistory: ScheduleFeedback[],
  current: FreeTimePriority
): FreeTimePriority {
  const answered = feedbackHistory
    .filter((f) => f.freeTimeFeeling != null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (answered.length < FEEDBACK_STREAK_LENGTH) return current;

  const recent = answered.slice(0, FEEDBACK_STREAK_LENGTH);
  const index = FREE_TIME_PRIORITY_ORDER.indexOf(current);

  if (recent.every((f) => f.freeTimeFeeling === "more")) {
    return FREE_TIME_PRIORITY_ORDER[Math.min(FREE_TIME_PRIORITY_ORDER.length - 1, index + 1)];
  }
  if (recent.every((f) => f.freeTimeFeeling === "less")) {
    return FREE_TIME_PRIORITY_ORDER[Math.max(0, index - 1)];
  }
  return current;
}

/**
 * Priority scoring (Part 3 / Part 15). Every factor is normalized to 0–1, combined with the
 * documented weights in `constants.ts`, and kept in a `PriorityBreakdown` so the result can be
 * explained rather than being a black box. Nothing here is random or time-of-run dependent
 * beyond the `now` passed in by the caller — same inputs always produce the same score.
 */
import {
  ASSIGNMENT_WEIGHT_SCORE,
  DEADLINE_STRICTNESS_SCORE,
  DEFAULT_PRIORITY_WEIGHTS,
  URGENCY_HORIZON_DAYS,
  WORK_TYPE_SCORE,
} from "./constants";
import { diffInDays } from "./date-utils";
import type { PriorityBreakdown, SchedulableWorkItem } from "./types";

/** Normalized workload factor: heavier remaining work justifies starting earlier. Caps at 3 hours. */
const WORKLOAD_NORMALIZATION_CAP_MINUTES = 180;

export function calculateWeightScore(item: SchedulableWorkItem): number {
  return ASSIGNMENT_WEIGHT_SCORE[item.weight];
}

/** 0 (far away) to 1 (due now or overdue). Decays linearly over `URGENCY_HORIZON_DAYS`. */
export function calculateUrgency(dueDate: string, now: string): number {
  const daysUntilDue = diffInDays(now, dueDate);
  if (daysUntilDue <= 0) return 1;
  return clamp01(1 - daysUntilDue / URGENCY_HORIZON_DAYS);
}

export function calculateStrictnessScore(item: SchedulableWorkItem): number {
  return DEADLINE_STRICTNESS_SCORE[item.deadlineStrictness];
}

export function calculateWorkloadScore(remainingMinutes: number): number {
  return clamp01(remainingMinutes / WORKLOAD_NORMALIZATION_CAP_MINUTES);
}

export function calculateTypeScore(item: SchedulableWorkItem): number {
  return WORK_TYPE_SCORE[item.workType];
}

export function isOverdue(dueDate: string, now: string): boolean {
  return diffInDays(now, dueDate) <= 0;
}

/**
 * Combines every factor into a single 0–1+ priority score (overdue items can exceed 1).
 * `remainingMinutes` is the still-unscheduled/unworked portion of the item, not its full estimate.
 */
export function calculatePriority(
  item: SchedulableWorkItem,
  context: { now: string; remainingMinutes: number }
): PriorityBreakdown {
  const weight = calculateWeightScore(item);
  const urgency = calculateUrgency(item.dueDate, context.now);
  const strictness = calculateStrictnessScore(item);
  const workload = calculateWorkloadScore(context.remainingMinutes);
  const type = calculateTypeScore(item);
  const overdue = isOverdue(item.dueDate, context.now) ? 1 : 0;

  const w = DEFAULT_PRIORITY_WEIGHTS;
  const score =
    weight * w.weight +
    urgency * w.urgency +
    strictness * w.strictness +
    workload * w.workload +
    type * w.type +
    overdue * w.overdue;

  return {
    workItemId: item.id,
    score,
    factors: { weight, urgency, strictness, workload, type, overdue },
  };
}

/** Turns a priority breakdown into a short, human-readable justification (Part 15). */
export function explainPriority(item: SchedulableWorkItem, breakdown: PriorityBreakdown): string {
  const parts: string[] = [];

  if (breakdown.factors.overdue > 0) {
    parts.push("is already overdue");
  }

  const weightPhrase =
    item.weight === "high" ? "high-weight" : item.weight === "medium" ? "medium-weight" : "low-weight";
  const strictnessPhrase =
    item.deadlineStrictness === "hard"
      ? "a hard deadline"
      : item.deadlineStrictness === "important"
        ? "an important deadline"
        : item.deadlineStrictness === "flexible"
          ? "a flexible deadline"
          : "a target date";

  parts.push(`is ${weightPhrase} with ${strictnessPhrase}`);

  const hours = Math.round((item.estimatedMinutes / 60) * 10) / 10;
  parts.push(`requires approximately ${hours >= 1 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${item.estimatedMinutes} minutes`} of work`);

  return `${item.title} received priority ${breakdown.score.toFixed(2)} because it ${parts.join(", ")}.`;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

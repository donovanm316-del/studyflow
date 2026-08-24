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
  FREE_TIME_PRIORITY_MULTIPLIER,
  MAX_DAILY_CAPACITY_MINUTES,
  RIGOR_CAPACITY_MULTIPLIER,
} from "./constants";
import type { PlanningProfile, CourseRigor } from "@/types/models";

export interface DailyCapacityContext {
  /** Rigor of the courses with work actually due soon — an empty array leaves the target unchanged. */
  relevantRigors: CourseRigor[];
  /** Whether the student currently has overdue work or a hard deadline that needs extra time. */
  isBehind: boolean;
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

  const target = base * rigorMultiplier * freeTimeMultiplier * behindMultiplier;
  return Math.min(max, Math.max(20, Math.round(target)));
}

function averageRigorMultiplier(rigors: CourseRigor[]): number {
  if (rigors.length === 0) return 1;
  const sum = rigors.reduce((total, rigor) => total + RIGOR_CAPACITY_MULTIPLIER[rigor], 0);
  return sum / rigors.length;
}

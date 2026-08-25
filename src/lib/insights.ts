/**
 * Pure, UI-facing analytics over stored session/feedback history (Phase 3A, Part 15). Deliberately
 * separate from the scheduling engine — this reads the past, the engine plans the future, and
 * neither needs the other. Every function here returns `null` when there isn't enough data to say
 * something honest, rather than showing a number built on one or two data points.
 */
import type { ScheduleFeedback, WorkSession } from "@/types/models";

/** Below this many data points, a "typical pattern" claim would be reading tea leaves. */
export const MIN_SESSIONS_FOR_HABIT_INSIGHT = 5;
/** Below this many completed sessions, a "weekly average" is not yet a meaningful average. */
export const MIN_SESSIONS_FOR_WORKLOAD_INSIGHT = 3;

export interface EstimateAccuracySummary {
  sessionCount: number;
  avgEstimatedMinutes: number;
  avgActualMinutes: number;
  /** avgActualMinutes - avgEstimatedMinutes; positive means sessions tend to run long. */
  avgDiffMinutes: number;
}

export function calculateEstimateAccuracy(sessions: WorkSession[]): EstimateAccuracySummary | null {
  const withEstimates = sessions.filter((s) => s.minutesSpent != null && s.plannedMinutes != null);
  if (withEstimates.length === 0) return null;

  const avgEstimated = withEstimates.reduce((sum, s) => sum + (s.plannedMinutes ?? 0), 0) / withEstimates.length;
  const avgActual = withEstimates.reduce((sum, s) => sum + (s.minutesSpent ?? 0), 0) / withEstimates.length;

  return {
    sessionCount: withEstimates.length,
    avgEstimatedMinutes: Math.round(avgEstimated),
    avgActualMinutes: Math.round(avgActual),
    avgDiffMinutes: Math.round(avgActual - avgEstimated),
  };
}

export interface TypicalWorkWindow {
  sessionCount: number;
  startHour: number; // 0-23
  endHour: number; // 1-24, exclusive
}

/** The 2-hour block that the most completed sessions started in — a real majority, not a guess. */
export function calculateTypicalWorkWindow(sessions: WorkSession[]): TypicalWorkWindow | null {
  const completed = sessions.filter((s) => s.minutesSpent != null);
  if (completed.length < MIN_SESSIONS_FOR_HABIT_INSIGHT) return null;

  const counts = new Array(24).fill(0);
  for (const s of completed) {
    const hour = Number(s.start.split("T")[1]?.split(":")[0] ?? 0);
    counts[hour] += 1;
  }

  let bestStart = 0;
  let bestCount = -1;
  for (let h = 0; h < 23; h++) {
    const windowCount = counts[h] + counts[h + 1];
    if (windowCount > bestCount) {
      bestCount = windowCount;
      bestStart = h;
    }
  }

  return { sessionCount: completed.length, startHour: bestStart, endHour: bestStart + 2 };
}

export interface PostponementRate {
  ratePercent: number;
  postponedCount: number;
  totalCount: number;
}

export function calculatePostponementRate(sessions: WorkSession[]): PostponementRate | null {
  if (sessions.length === 0) return null;
  const postponedCount = sessions.filter((s) => s.postponed).length;
  return { ratePercent: Math.round((postponedCount / sessions.length) * 100), postponedCount, totalCount: sessions.length };
}

export interface BusiestDay {
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  sessionCount: number;
}

export function calculateBusiestDayOfWeek(sessions: WorkSession[]): BusiestDay | null {
  const completed = sessions.filter((s) => s.minutesSpent != null);
  if (completed.length < MIN_SESSIONS_FOR_HABIT_INSIGHT) return null;

  const counts = new Array(7).fill(0);
  for (const s of completed) {
    const [y, m, d] = s.start.split("T")[0].split("-").map(Number);
    counts[new Date(y, m - 1, d).getDay()] += 1;
  }

  let bestDay = 0;
  for (let d = 1; d < 7; d++) {
    if (counts[d] > counts[bestDay]) bestDay = d;
  }
  return counts[bestDay] > 0 ? { dayOfWeek: bestDay, sessionCount: counts[bestDay] } : null;
}

/** Total completed minutes, averaged per week across the span the sessions actually cover. */
export function calculateAverageWeeklyWorkloadMinutes(sessions: WorkSession[]): number | null {
  const completed = sessions.filter((s) => s.minutesSpent != null);
  if (completed.length < MIN_SESSIONS_FOR_WORKLOAD_INSIGHT) return null;

  const totalMinutes = completed.reduce((sum, s) => sum + (s.minutesSpent ?? 0), 0);
  const dates = completed.map((s) => s.start.slice(0, 10)).sort();
  const spanDays = diffDaysBetweenDateOnly(dates[0], dates[dates.length - 1]) + 1;
  const weeks = Math.max(1, spanDays / 7);

  return Math.round(totalMinutes / weeks);
}

export interface FeedbackTally {
  tooHeavy: number;
  justRight: number;
  tooLight: number;
  total: number;
}

export function calculateFeedbackTally(feedback: ScheduleFeedback[]): FeedbackTally | null {
  if (feedback.length === 0) return null;
  return {
    tooHeavy: feedback.filter((f) => f.workloadFeeling === "too-heavy").length,
    justRight: feedback.filter((f) => f.workloadFeeling === "just-right").length,
    tooLight: feedback.filter((f) => f.workloadFeeling === "too-light").length,
    total: feedback.length,
  };
}

function diffDaysBetweenDateOnly(a: string, b: string): number {
  const toUtcMs = (dateOnly: string) => {
    const [y, m, d] = dateOnly.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86_400_000);
}

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function formatHourLabel(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12} ${period}`;
}

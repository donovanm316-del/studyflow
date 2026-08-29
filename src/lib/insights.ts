/**
 * Pure, UI-facing analytics over stored session/feedback history (Phase 3A, Part 15). Deliberately
 * separate from the scheduling engine — this reads the past, the engine plans the future, and
 * neither needs the other. Every function here returns `null` when there isn't enough data to say
 * something honest, rather than showing a number built on one or two data points.
 */
import type { ScheduleFeedback, WorkSession, WorkType } from "@/types/models";

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

/** Below this many samples in a category, any "you underestimate X" claim is reading noise. */
export const MIN_SESSIONS_FOR_CATEGORY_INSIGHT = 4;

export interface CategoryAccuracy {
  workType: WorkType;
  label: string;
  sessionCount: number;
  /** Median actual÷estimated. >1 means this kind of work runs long for this student. */
  medianRatio: number;
  /** Signed percentage difference, rounded — e.g. +12 means "12% longer than estimated". */
  percentDifference: number;
}

const WORK_TYPE_LABEL: Record<WorkType, string> = {
  homework: "Homework",
  reading: "Reading",
  "study-session": "Study sessions",
  "test-prep": "Test prep",
  "quiz-prep": "Quiz prep",
  project: "Projects",
  essay: "Essays",
  "long-term": "Long-term work",
};

/**
 * Estimate accuracy broken down by kind of work (Phase 4.5C, Part 3), so a student can see *where*
 * their estimating is off rather than only that it is. Categories below
 * `MIN_SESSIONS_FOR_CATEGORY_INSIGHT` are omitted entirely — a confident-sounding claim from two
 * sessions is worse than saying nothing.
 *
 * This reports the same median-ratio measure the planning personalization acts on (see
 * `scheduling-engine/estimation.ts`), so what the student reads here matches what the scheduler does.
 */
export function calculateAccuracyByWorkType(
  sessions: WorkSession[],
  workItems: { id: string; workType: WorkType }[],
  stages: { id: string; workItemId: string }[] = []
): CategoryAccuracy[] {
  const itemById = new Map(workItems.map((i) => [i.id, i]));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const byType = new Map<WorkType, number[]>();

  for (const s of sessions) {
    if (s.plannedMinutes == null || s.minutesSpent == null || s.plannedMinutes <= 0 || s.minutesSpent <= 0) continue;
    const stage = stageById.get(s.workItemId);
    const item = itemById.get(stage ? stage.workItemId : s.workItemId);
    if (!item) continue;
    if (!byType.has(item.workType)) byType.set(item.workType, []);
    byType.get(item.workType)!.push(s.minutesSpent / s.plannedMinutes);
  }

  const results: CategoryAccuracy[] = [];
  for (const [workType, ratios] of byType) {
    if (ratios.length < MIN_SESSIONS_FOR_CATEGORY_INSIGHT) continue;
    const sorted = [...ratios].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianRatio = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    results.push({
      workType,
      label: WORK_TYPE_LABEL[workType] ?? workType,
      sessionCount: ratios.length,
      medianRatio,
      percentDifference: Math.round((medianRatio - 1) * 100),
    });
  }

  // Largest divergence first — that's the one worth acting on.
  return results.sort((a, b) => Math.abs(b.percentDifference) - Math.abs(a.percentDifference));
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

/**
 * Course-level and week-level workload insight (Phase 5C, Parts 1–3, 7).
 *
 * ARCHITECTURAL RULE, same as `decision-support.ts`: nothing here is a second scheduler or a second
 * capacity calculation. Every function reads numbers a `GenerateScheduleResult` already computed —
 * `deadlineCapacities` for per-item risk and remaining work, `dailyForecast`/`workloadStatus` for
 * the week picture — and groups or compares them. There is no arbitrary "overloaded" threshold
 * invented here: risk comes from the engine's own `DeadlineRiskLevel`, which already accounts for
 * the student's real availability.
 *
 * Provider-neutral on purpose, despite living next to the Classroom UI that mostly uses it: a
 * course is identified by `subject`, the same field manually-created work already uses, so a
 * StudyFlow-typed assignment and a Classroom-imported one for the same class land in one row. This
 * module has no Google-specific code in it.
 */
import {
  formatMinutesAsHoursMinutes,
  weekdayName,
  type DailyForecastEntry,
  type DeadlineCapacity,
  type DeadlineRiskLevel,
  type GenerateScheduleResult,
  type SchedulableWorkItem,
} from "@/scheduling-engine";
import { buildDayHealth, RISK_SEVERITY, summarizeWeek } from "@/lib/decision-support";

function worseRisk(a: DeadlineRiskLevel, b: DeadlineRiskLevel): DeadlineRiskLevel {
  return RISK_SEVERITY[b] > RISK_SEVERITY[a] ? b : a;
}

export interface CourseWorkload {
  subject: string;
  remainingMinutes: number;
  /** Items due on or before the horizon date passed to `courseWorkloadBreakdown`. */
  dueSoonCount: number;
  /** The worst (most urgent) risk among this course's items — never averaged or softened. */
  risk: DeadlineRiskLevel;
  /** The earliest upcoming deadline in this course, if any work remains. */
  nextDeadline?: string;
  itemIds: string[];
  /** A real Classroom link from one of this course's imported items, if any — never constructed. */
  classroomUrl?: string;
}

/**
 * Groups not-yet-completed work by `subject` and reduces each group to what a student actually
 * wants to know: how much is left, how much of it is due soon, and how worried to be about it.
 *
 * Only items the engine actually assessed — i.e. present in `deadlineCapacities` — are counted, so
 * this can never disagree with the capacity/risk shown elsewhere for the same item.
 */
export function courseWorkloadBreakdown(
  workItems: SchedulableWorkItem[],
  deadlineCapacities: Record<string, DeadlineCapacity>,
  dueSoonCutoff: string
): CourseWorkload[] {
  const bySubject = new Map<string, CourseWorkload>();

  for (const item of workItems) {
    if (item.status === "completed") continue;
    const capacity = deadlineCapacities[item.id];
    if (!capacity) continue;

    const subject = item.subject?.trim() || "No subject";
    const entry: CourseWorkload = bySubject.get(subject) ?? {
      subject,
      remainingMinutes: 0,
      dueSoonCount: 0,
      risk: "comfortable",
      itemIds: [],
    };

    entry.remainingMinutes += Math.max(0, capacity.estimatedMinutes);
    if (item.dueDate.slice(0, 10) <= dueSoonCutoff) entry.dueSoonCount += 1;
    entry.risk = worseRisk(entry.risk, capacity.risk);
    entry.itemIds.push(item.id);
    if (capacity.estimatedMinutes > 0 && (!entry.nextDeadline || item.dueDate < entry.nextDeadline)) {
      entry.nextDeadline = item.dueDate;
    }
    if (item.source === "google-classroom" && item.externalUrl && !entry.classroomUrl) entry.classroomUrl = item.externalUrl;

    bySubject.set(subject, entry);
  }

  return [...bySubject.values()].sort((a, b) => b.remainingMinutes - a.remainingMinutes);
}

/**
 * The course with the most remaining work — "History is currently your busiest course" (Part 2).
 * `null` with fewer than two courses: "busiest" is meaningless when there's nothing to compare
 * against, and repeating the only course's own name back isn't an insight.
 */
export function busiestCourse(breakdown: CourseWorkload[]): CourseWorkload | null {
  if (breakdown.length < 2) return null;
  const busiest = breakdown[0]; // already sorted by remainingMinutes descending
  return busiest.remainingMinutes > 0 ? busiest : null;
}

/**
 * Which weekday a course's *currently scheduled* work is concentrated on — "Your Biology workload
 * is concentrated on Thursday" (Part 2). Reads real placed/completed blocks for that course's
 * items (a stage's block still counts, via `itemIds` already covering parent ids only — stage
 * blocks are matched by the caller's `blockMatchesWorkItem`, kept out of this pure function to
 * avoid a second copy of that resolution).
 *
 * Returns `null` unless one day genuinely dominates (at least 3 blocks, and that day holding at
 * least half of them) — otherwise "concentrated" would be a claim about a spread that isn't
 * actually lopsided.
 */
export function courseConcentrationDay(blockDatesForCourse: string[]): string | null {
  if (blockDatesForCourse.length < 3) return null;

  const counts = new Map<string, number>();
  for (const date of blockDatesForCourse) counts.set(date, (counts.get(date) ?? 0) + 1);

  const [topDate, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return topCount >= blockDatesForCourse.length / 2 ? weekdayName(topDate) : null;
}

/**
 * "What this means for your week" (Part 7) — deterministic template lines built only from real
 * engine state. Each line is independently gated on having real data behind it; a week with nothing
 * due, or with no work at all, simply produces fewer lines rather than a padded-out summary.
 *
 * Capped at a handful of lines on purpose (Part 7: "do not overwhelm the student with statistics") —
 * this answers "how bad is my week", not "here is every number StudyFlow has".
 */
export function buildWeekInsightLines(
  result: GenerateScheduleResult,
  workItems: SchedulableWorkItem[],
  weekStart: string,
  weekEnd: string
): string[] {
  const lines: string[] = [];

  const dueThisWeek = workItems.filter(
    (item) => item.status !== "completed" && item.dueDate.slice(0, 10) >= weekStart && item.dueDate.slice(0, 10) <= weekEnd
  );
  if (dueThisWeek.length > 0) {
    lines.push(`You have ${dueThisWeek.length} assignment${dueThisWeek.length === 1 ? "" : "s"} due this week.`);
  }

  if (result.workloadStatus.estimatedRemainingMinutes > 0) {
    lines.push(`About ${formatMinutesAsHoursMinutes(result.workloadStatus.estimatedRemainingMinutes)} of estimated work remains.`);
  }

  const days = buildDayHealth(result);
  const pressured = days.filter((d) => d.status === "over-capacity" || d.status === "getting-tight");
  if (pressured.length > 0) {
    const names = pressured.map((d) => weekdayName(d.date));
    const label = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    lines.push(`Most of the pressure on your week falls on ${label}.`);
  }

  const atRiskCount = dueThisWeek.filter((item) => result.deadlineCapacities[item.id]?.risk === "at-risk").length;
  if (atRiskCount > 0) {
    lines.push(
      `${atRiskCount} assignment${atRiskCount === 1 ? " has" : "s have"} less usable time remaining than ${
        atRiskCount === 1 ? "its" : "their"
      } estimated workload.`
    );
  }

  if (result.workloadStatus.bufferMinutes > 0 && result.workloadStatus.level !== "at-risk") {
    lines.push(`Your schedule currently has about ${formatMinutesAsHoursMinutes(result.workloadStatus.bufferMinutes)} of buffer before your deadlines.`);
  }

  lines.push(summarizeWeek(result).headline);

  return lines.slice(0, 5);
}

/** The single day the engine's own forecast projects the most work onto, if any work exists. */
export function busiestForecastDay(dailyForecast: DailyForecastEntry[]): DailyForecastEntry | null {
  const withWork = dailyForecast.filter((d) => d.workMinutes > 0);
  if (withWork.length === 0) return null;
  return [...withWork].sort((a, b) => b.workMinutes - a.workMinutes)[0];
}

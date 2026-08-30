/**
 * The boundary where Google's shapes stop and StudyFlow's begin.
 *
 *   Google Course      → ExternalCourse
 *   Google CourseWork  → ExternalWorkItem (the Phase 4.5D import boundary)
 *                      → normalizeExternalItem() → NewWorkItemInput → scheduling engine
 *
 * Everything here is pure and synchronous: no network, no environment, no clock beyond what's
 * passed in. That's what makes the deadline handling below testable, which matters because it is
 * the one place in this integration where a subtle bug would quietly corrupt a student's schedule.
 */
import type { ExternalWorkItem } from "@/lib/data/import";
import {
  CLASSROOM_PROVIDER,
  type ExternalCourse,
  type ExternalCourseState,
  type GoogleCourse,
  type GoogleCourseWork,
  type GoogleDate,
  type GoogleTimeOfDay,
} from "./types";

const COURSE_STATES: Record<string, ExternalCourseState> = {
  ACTIVE: "active",
  ARCHIVED: "archived",
  PROVISIONED: "provisioned",
  DECLINED: "declined",
};

function trimmed(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

/**
 * Converts one Google course, or returns `null` if it can't be represented honestly.
 *
 * A course with no id can never be re-identified on a later sync, and one with no name has nothing
 * to show the student. Both are dropped rather than backfilled with a placeholder — an invented
 * "Untitled course" would look like a real class the student had forgotten about.
 */
export function normalizeCourse(raw: GoogleCourse): ExternalCourse | null {
  const externalCourseId = trimmed(raw.id);
  const name = trimmed(raw.name);
  if (!externalCourseId || !name) return null;

  return {
    provider: CLASSROOM_PROVIDER,
    externalCourseId,
    name,
    section: trimmed(raw.section),
    description: trimmed(raw.description) ?? trimmed(raw.descriptionHeading),
    state: COURSE_STATES[raw.courseState ?? ""] ?? "unknown",
    url: trimmed(raw.alternateLink),
  };
}

/** Drops anything unrepresentable instead of failing the whole page of results. */
export function normalizeCourses(raw: GoogleCourse[]): ExternalCourse[] {
  return raw.map(normalizeCourse).filter((c): c is ExternalCourse => c !== null);
}

/**
 * A Classroom due date, carrying whether Google actually gave a time.
 *
 * `value` is either "YYYY-MM-DDTHH:mm" (exact) or "YYYY-MM-DD" (date only). Both are valid input to
 * StudyFlow's `normalizeDeadline`, which remains the single normalization point — this function
 * never applies the 11:59 PM default itself.
 */
export interface ClassroomDeadline {
  value: string;
  /** True only when Classroom supplied a real time of day. Never inferred. */
  hasExactTime: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Turns Classroom's UTC `dueDate` + `dueTime` into a StudyFlow deadline.
 *
 * Two things here are easy to get wrong and both would be invisible until a student missed work:
 *
 * **The zero-value trap.** Classroom serializes protobuf, which omits zero-valued fields. A due
 * time of exactly 00:00 UTC therefore arrives as `dueTime: {}` — byte-identical to a `dueTime` that
 * was never set, except that the *key itself* is present. So presence of the key, not truthiness of
 * its contents, decides whether a time exists. Reading `dueTime.hours` for a truthiness check would
 * silently reclassify every midnight-UTC deadline as date-only.
 *
 * **Time zones.** `dueDate` + `dueTime` together name a real instant, so the pair is converted into
 * the student's local wall clock — this legitimately shifts the calendar date (a 03:00 UTC deadline
 * is the *previous* evening in New York), and that shift is the correct answer, not a bug.
 * `dueDate` alone names no instant at all, so it is passed through untouched: shifting it would
 * mean inventing a time Google never gave, which Phase 4.5A explicitly forbids.
 */
export function normalizeClassroomDeadline(
  dueDate: GoogleDate | undefined,
  dueTime: GoogleTimeOfDay | undefined
): ClassroomDeadline | null {
  if (!dueDate?.year || !dueDate.month || !dueDate.day) return null;

  const { year, month, day } = dueDate;

  if (dueTime === undefined) {
    return { value: `${year}-${pad(month)}-${pad(day)}`, hasExactTime: false };
  }

  const local = new Date(Date.UTC(year, month - 1, day, dueTime.hours ?? 0, dueTime.minutes ?? 0));
  const value =
    `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}` +
    `T${pad(local.getHours())}:${pad(local.getMinutes())}`;
  return { value, hasExactTime: true };
}

/**
 * Converts one piece of Classroom coursework into the Phase 4.5D import shape.
 *
 * Defined now so the deadline handling above can be tested against real coursework, and so Phase
 * 5B inherits a boundary that already exists rather than inventing one under deadline pressure.
 * **Nothing calls this yet** — Phase 5A retrieves courses only, and no coursework is fetched,
 * imported, or scheduled.
 *
 * Note what is *not* derived here: no estimated duration, no importance, no work type. Classroom
 * knows none of those, and guessing them from a title or description would be exactly the invented
 * functionality this project forbids. The student supplies them at import time.
 */
export function normalizeCourseWork(raw: GoogleCourseWork, courseName?: string): ExternalWorkItem | null {
  const externalId = trimmed(raw.id);
  const title = trimmed(raw.title);
  if (!externalId || !title) return null;

  const deadline = normalizeClassroomDeadline(raw.dueDate, raw.dueTime);

  return {
    source: CLASSROOM_PROVIDER,
    externalId,
    externalCourseId: trimmed(raw.courseId),
    title,
    dueDate: deadline?.value,
    courseName: trimmed(courseName),
    externalUrl: trimmed(raw.alternateLink),
    sourceUpdatedAt: trimmed(raw.updateTime),
  };
}

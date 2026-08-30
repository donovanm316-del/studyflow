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
import type { ExternalSourceState, ExternalWorkItem, ExternalWorkTypeHint } from "@/lib/data/import";
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
 * Classroom's `CourseWorkState` → StudyFlow's provider-neutral lifecycle.
 *
 * `DRAFT` is included for completeness only; Classroom does not return draft coursework to
 * students, so in practice it never arrives.
 */
const SOURCE_STATES: Record<string, ExternalSourceState> = {
  PUBLISHED: "active",
  DRAFT: "draft",
  DELETED: "removed",
};

/**
 * Classroom's `CourseWorkType` → a coarse hint, and nothing more.
 *
 * This is the mapping the phase spec is strictest about, so it is worth being explicit about what
 * it refuses to do. Classroom's `ASSIGNMENT` means "a thing to hand in". It does not distinguish a
 * twenty-minute worksheet from a three-week research project, and StudyFlow's `workType` —
 * which drives splittability, session shape and capacity — genuinely needs that distinction.
 *
 * So every piece of coursework becomes a plain assignment. StudyFlow does **not** classify anything
 * as a test, quiz, essay, project, or reading on import, because nothing in the Classroom payload
 * reliably supports that. There is no title-keyword rule here: "Unit 5 Test Review" is revision, not
 * a test, and a rule that got that wrong would silently mis-schedule a student's exam prep. The
 * student changes the type in one click if it matters, and the review screen shows what they're
 * getting before anything is imported.
 *
 * `MULTIPLE_CHOICE_QUESTION` and `SHORT_ANSWER_QUESTION` collapse to `question` — worth recording
 * because they are reliably small, but still not enough to justify inventing a duration.
 */
const WORK_TYPE_HINTS: Record<string, ExternalWorkTypeHint> = {
  ASSIGNMENT: "assignment",
  SHORT_ANSWER_QUESTION: "question",
  MULTIPLE_CHOICE_QUESTION: "question",
};

export interface CourseContext {
  name?: string;
  section?: string;
}

/**
 * Converts one piece of Classroom coursework into the provider-neutral import shape.
 *
 * Everything Classroom actually said is preserved — id, course id, title, description, course name
 * and section, work type, state, timestamps, deadline, and the Classroom link.
 *
 * Note what is *not* derived here: no estimated duration, no importance, no deadline strictness, no
 * specific work type. Classroom knows none of those. Guessing them from a title or a description is
 * exactly the invented functionality this project forbids, and the failure mode is not cosmetic —
 * a fabricated two-hour estimate distorts capacity, urgency, and every downstream recommendation.
 * The student supplies them at review time, or the item is flagged as still needing them.
 */
export function normalizeCourseWork(raw: GoogleCourseWork, course: CourseContext = {}): ExternalWorkItem | null {
  const externalId = trimmed(raw.id);
  const title = trimmed(raw.title);
  if (!externalId || !title) return null;

  const deadline = normalizeClassroomDeadline(raw.dueDate, raw.dueTime);

  return {
    source: CLASSROOM_PROVIDER,
    externalId,
    externalCourseId: trimmed(raw.courseId),
    title,
    description: trimmed(raw.description),
    dueDate: deadline?.value,
    hasExactDeadline: deadline?.hasExactTime ?? false,
    courseName: trimmed(course.name),
    courseSection: trimmed(course.section),
    externalUrl: trimmed(raw.alternateLink),
    workTypeHint: WORK_TYPE_HINTS[raw.workType ?? ""] ?? "unknown",
    sourceState: SOURCE_STATES[raw.state ?? ""] ?? "unknown",
    sourceCreatedAt: trimmed(raw.creationTime),
    sourceUpdatedAt: trimmed(raw.updateTime),
  };
}

/**
 * Normalizes a page of coursework, dropping only what can't be represented honestly.
 *
 * Deleted coursework is filtered out here rather than downstream: it is not work the student can
 * do, and offering it for import would be offering something that no longer exists. An item that
 * was *already* imported and has since been deleted is a different matter — that is detected by its
 * absence during reconciliation, and never deletes the student's copy.
 */
export function normalizeCourseWorkList(raw: GoogleCourseWork[], course: CourseContext = {}): ExternalWorkItem[] {
  return raw
    .map((item) => normalizeCourseWork(item, course))
    .filter((item): item is ExternalWorkItem => item !== null && item.sourceState !== "removed" && item.sourceState !== "draft");
}

/**
 * The boundary between an external coursework source and StudyFlow's own work items.
 *
 * Defined in Phase 4.5D as a shape with no implementation behind it; Phase 5B put a real Google
 * Classroom importer on the other side of it. Nothing here knows that: there is no Google code in
 * this file, and there shouldn't be. Everything below is provider-neutral, which is what lets the
 * reconciliation logic and its tests be written without a network, an API key, or a mock.
 *
 *   External source → normalizeExternalItem() → NewWorkItemInput → existing scheduling engine
 *
 * Two rules this pins down:
 *
 *  1. **The engine stays source-agnostic.** Nothing downstream reads `source`/`externalId`; they
 *     exist for display and for recognizing an item on re-import. A scenario test asserts an
 *     imported item schedules byte-identically to a manually-created one.
 *  2. **Re-import must not overwrite the student.** External systems know a title and a due date.
 *     They do not know that the student estimated three hours, marked it high-importance, or
 *     already logged two sessions against it. `mergeImportedItem` therefore refreshes only the
 *     fields the source owns and leaves every planning decision the student made intact.
 */
import { normalizeDeadline, type SchedulableWorkItem } from "@/scheduling-engine";
import type { AssignmentWeight, DeadlineStrictness, SourceSnapshot, WorkItemSource, WorkType } from "@/types/models";
import type { NewWorkItemInput } from "./store";

/**
 * How confident the source is about what kind of academic work this is.
 *
 * Provider-neutral on purpose. Google Classroom's `CourseWorkType` distinguishes an assignment from
 * a quiz *question*, which is not the same axis as StudyFlow's essay/project/test distinction, so
 * the vocabulary is kept deliberately coarse rather than pretending to a precision the source
 * doesn't have.
 */
export type ExternalWorkTypeHint = "assignment" | "question" | "unknown";

/**
 * The item's lifecycle in the source system.
 *
 * `removed` covers both deletion and disappearing from the active listing — from StudyFlow's side
 * those are the same event, and neither one ever deletes the student's work.
 */
export type ExternalSourceState = "active" | "draft" | "removed" | "unknown";

/** What an external system supplies. Fields are added when a real integration needs them. */
export interface ExternalWorkItem {
  source: WorkItemSource;
  /** Stable id in the source system. Required — without it, re-import can't avoid duplicates. */
  externalId: string;
  title: string;
  /**
   * ISO date or date-time. A date with no time is read as 11:59 PM by `normalizeDeadline`, as
   * everywhere else in StudyFlow. Absent means the source genuinely has no deadline.
   */
  dueDate?: string;
  /** True only when the source supplied a real time of day. Never inferred from the date. */
  hasExactDeadline?: boolean;
  /** Course/class name, mapped onto `subject` for estimate personalization matching. */
  courseName?: string;
  /** e.g. "Period 3". Kept for display; deliberately not folded into `subject`, which drives matching. */
  courseSection?: string;
  externalUrl?: string;
  /** Long-form instructions from the source. Shown at review time; not used for any inference. */
  description?: string;
  /**
   * The class this item belongs to in the source system. Kept alongside `courseName` rather than
   * instead of it: the name is what the student reads and a teacher can rename at any time, while
   * the id is what a re-sync relies on.
   */
  externalCourseId?: string;
  workTypeHint?: ExternalWorkTypeHint;
  sourceState?: ExternalSourceState;
  sourceCreatedAt?: string;
  /**
   * When the source last modified this item, verbatim from the provider. A cheap first-pass signal
   * for change detection; the authoritative comparison is the field-by-field one in
   * `classroom-sync.ts`, because a provider can bump this timestamp for changes StudyFlow doesn't
   * care about, and (less often) fail to bump it for ones it does.
   */
  sourceUpdatedAt?: string;
}

/** What the student must fill in themselves, because no external system knows it. */
export interface ImportDefaults {
  estimatedMinutes: number;
  weight: AssignmentWeight;
  deadlineStrictness: DeadlineStrictness;
  workType: WorkType;
}

/**
 * The neutral starting point for an imported item.
 *
 * `estimatedMinutes: 30` is a **placeholder, not a prediction** — Classroom does not say how long
 * anything takes, and neither does StudyFlow until the student says so or has logged real sessions.
 * Every item imported without the student setting a number carries `needsEstimate: true`, which is
 * what the UI reads to label it honestly instead of presenting 30 minutes as if it meant something.
 * The engine needs *a* number to plan with; the flag is what stops that number from lying.
 */
export const DEFAULT_IMPORT_DEFAULTS: ImportDefaults = {
  estimatedMinutes: 30,
  weight: "medium",
  deadlineStrictness: "hard",
  workType: "homework",
};

/** Per-item decisions the student makes on the review screen before importing. */
export interface ImportChoices {
  /** Student-supplied estimate. Omitted means "still unknown" → `needsEstimate` is set. */
  estimatedMinutes?: number;
  /**
   * A StudyFlow-side target date for work the source has no deadline for. Required to import an
   * undated item — StudyFlow will not invent one (Part 19).
   */
  targetDate?: string;
  weight?: AssignmentWeight;
  deadlineStrictness?: DeadlineStrictness;
}

/**
 * Converts one external item into the same input shape the "Add assignment" form produces, so
 * imported and hand-entered work are indistinguishable to everything downstream.
 *
 * Returns `null` when the item has neither a source deadline nor a student-supplied target date.
 * That is the honest outcome: the scheduler is deadline-driven, and quietly defaulting an undated
 * item to "today at 11:59 PM" would inject fake urgency into a real student's week. The review UI
 * surfaces these separately and asks for a date instead.
 */
export function normalizeExternalItem(
  external: ExternalWorkItem,
  todayDateOnly: string,
  choices: ImportChoices = {},
  defaults: ImportDefaults = DEFAULT_IMPORT_DEFAULTS
): NewWorkItemInput | null {
  const deadline = external.dueDate?.trim() || choices.targetDate?.trim();
  if (!deadline) return null;

  const estimatedMinutes = choices.estimatedMinutes ?? defaults.estimatedMinutes;

  return {
    kind: "assignment",
    title: external.title.trim() || "Untitled assignment",
    subject: external.courseName?.trim() || undefined,
    dueDate: normalizeDeadline(deadline),
    ...defaults,
    estimatedMinutes,
    weight: choices.weight ?? defaults.weight,
    // An item with no source deadline is planned against a date the *student* chose, so treating it
    // as a hard deadline would misrepresent their own target back to them.
    deadlineStrictness: choices.deadlineStrictness ?? (external.dueDate ? defaults.deadlineStrictness : "target"),
    needsEstimate: choices.estimatedMinutes === undefined ? true : undefined,
    source: external.source,
    externalId: external.externalId,
    externalCourseId: external.externalCourseId,
    externalUrl: external.externalUrl,
    sourceUpdatedAt: external.sourceUpdatedAt,
    sourceSnapshot: snapshotOf(external),
  } as NewWorkItemInput;
}

/**
 * The last-known state of the fields the source owns.
 *
 * Stored on the work item, and the reason change detection stays correct after the student edits
 * their own copy. Comparing incoming Classroom data against the *item's current values* would
 * report the student's own rename as a teacher change; comparing against this snapshot reports only
 * what actually moved on Classroom's side. Deliberately three fields — the minimum that makes the
 * comparison work (Part 29), not a copy of the API response.
 */
export function snapshotOf(external: ExternalWorkItem): SourceSnapshot {
  return {
    title: external.title.trim(),
    dueDate: external.dueDate ? normalizeDeadline(external.dueDate) : undefined,
    courseName: external.courseName?.trim() || undefined,
  };
}

/** Finds an already-imported item, matched on source + external id rather than on title. */
export function findImportedMatch(
  existing: SchedulableWorkItem[],
  external: ExternalWorkItem
): SchedulableWorkItem | undefined {
  return existing.find((item) => item.source === external.source && item.externalId === external.externalId);
}

/**
 * The patch to apply when re-importing an item StudyFlow already has.
 *
 * Only the fields the source genuinely owns — title, due date, link, course — are refreshed.
 * Estimates, importance, strictness, preferred start date, personalization preference, status and
 * logged time are the student's, and are never touched. Returns `null` when nothing changed, so a
 * re-import that found no updates doesn't churn `updatedAt` or trigger a pointless replan.
 *
 * The comparison is against `sourceSnapshot`, not against the item's live values, so a student who
 * renamed their copy of an assignment doesn't get it renamed back on every sync.
 */
export function mergeImportedItem(
  existing: SchedulableWorkItem,
  external: ExternalWorkItem
): Partial<NewWorkItemInput> | null {
  const incoming = snapshotOf(external);
  // Items imported before snapshots existed fall back to their live values — the one case where a
  // student edit can look like a source change, and only ever once.
  const previous: SourceSnapshot = existing.sourceSnapshot ?? {
    title: existing.title,
    dueDate: normalizeDeadline(existing.dueDate),
    courseName: existing.subject,
  };

  const patch: Partial<NewWorkItemInput> = {};
  if (incoming.title !== previous.title) patch.title = incoming.title;
  if (incoming.dueDate && incoming.dueDate !== previous.dueDate) patch.dueDate = incoming.dueDate;
  if (incoming.courseName !== previous.courseName) patch.subject = incoming.courseName;
  if (external.externalUrl !== existing.externalUrl) patch.externalUrl = external.externalUrl;

  if (Object.keys(patch).length === 0) return null;

  // The snapshot advances with the patch, so the same change is never reported twice.
  return { ...patch, sourceSnapshot: incoming, sourceUpdatedAt: external.sourceUpdatedAt } as Partial<NewWorkItemInput>;
}

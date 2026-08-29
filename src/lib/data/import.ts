/**
 * The boundary between an external assignment source and StudyFlow's own work items
 * (Phase 4.5D, Part 13).
 *
 * NO INTEGRATION IS IMPLEMENTED HERE. There is no Google Classroom code, no OAuth, no network
 * access, and no fake Classroom data anywhere in this file. What exists is the shape a future
 * importer must produce and the merge rule it must follow, defined and tested up front because
 * both are easy to get quietly wrong:
 *
 *   External source → normalizeExternalItem() → NewWorkItemInput → existing scheduling engine
 *
 * Two things this pins down that a Phase 5 importer would otherwise have to reinvent:
 *
 *  1. **The engine stays source-agnostic.** Nothing downstream reads `source`/`externalId`; they
 *     exist for display and for recognizing an item on re-import. A scenario test asserts an
 *     imported item schedules byte-identically to a manually-created one.
 *  2. **Re-import must not overwrite the student.** External systems know a title and a due date.
 *     They do not know that the student estimated three hours, marked it high-importance, or
 *     already logged two sessions against it. `mergeImportedItem` therefore refreshes only the
 *     fields the source owns and leaves every planning decision the student made intact.
 */
import { DEFAULT_DEADLINE_TIME, normalizeDeadline, type SchedulableWorkItem } from "@/scheduling-engine";
import type { AssignmentWeight, DeadlineStrictness, WorkItemSource, WorkType } from "@/types/models";
import type { NewWorkItemInput } from "./store";

/**
 * The minimum an external system must supply. Deliberately small — fields are added when a real
 * integration proves it needs them, not because a provider happens to expose them.
 */
export interface ExternalWorkItem {
  source: WorkItemSource;
  /** Stable id in the source system. Required — without it, re-import can't avoid duplicates. */
  externalId: string;
  title: string;
  /** ISO date or date-time. A date with no time is read as 11:59 PM, as everywhere else. */
  dueDate?: string;
  /** Course/class name, mapped onto `subject` for estimate personalization matching. */
  courseName?: string;
  externalUrl?: string;
}

/** What the student must fill in themselves, because no external system knows it. */
export interface ImportDefaults {
  estimatedMinutes: number;
  weight: AssignmentWeight;
  deadlineStrictness: DeadlineStrictness;
  workType: WorkType;
}

export const DEFAULT_IMPORT_DEFAULTS: ImportDefaults = {
  estimatedMinutes: 30,
  weight: "medium",
  deadlineStrictness: "hard",
  workType: "homework",
};

/**
 * Converts one external item into the same input shape the "Add assignment" form produces, so
 * imported and hand-entered work are indistinguishable to everything downstream.
 *
 * An item with no due date gets today's date at 11:59 PM rather than being dropped: the scheduler
 * requires a deadline, and an item the student can see and correct is more useful than one that
 * silently failed to import. A real importer should flag these for review.
 */
export function normalizeExternalItem(
  external: ExternalWorkItem,
  todayDateOnly: string,
  defaults: ImportDefaults = DEFAULT_IMPORT_DEFAULTS
): NewWorkItemInput {
  return {
    kind: "assignment",
    title: external.title.trim() || "Untitled assignment",
    subject: external.courseName?.trim() || undefined,
    dueDate: normalizeDeadline(external.dueDate?.trim() || `${todayDateOnly}T${DEFAULT_DEADLINE_TIME}`),
    ...defaults,
    source: external.source,
    externalId: external.externalId,
    externalUrl: external.externalUrl,
  } as NewWorkItemInput;
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
 */
export function mergeImportedItem(
  existing: SchedulableWorkItem,
  external: ExternalWorkItem,
  todayDateOnly: string
): Partial<NewWorkItemInput> | null {
  const incoming = normalizeExternalItem(external, todayDateOnly);
  const patch: Partial<NewWorkItemInput> = {};

  if (incoming.title !== existing.title) patch.title = incoming.title;
  if (incoming.dueDate !== normalizeDeadline(existing.dueDate)) patch.dueDate = incoming.dueDate;
  if (incoming.subject !== existing.subject) patch.subject = incoming.subject;
  if (incoming.externalUrl !== existing.externalUrl) patch.externalUrl = incoming.externalUrl;

  return Object.keys(patch).length > 0 ? patch : null;
}

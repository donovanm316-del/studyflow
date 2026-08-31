/**
 * Reconciliation: deciding what a fresh look at Classroom actually means for a student's planner.
 *
 * This is the layer that has to be trustworthy. Everything else in the integration moves data
 * around; this is where StudyFlow decides whether to add work, change a deadline, or leave the
 * student alone — and where getting it wrong would mean either silently rewriting their week or
 * quietly duplicating half of it.
 *
 * Pure and synchronous. No network, no storage, no clock beyond what's passed in. Every scenario
 * the phase spec asks about — teacher moves a deadline, assignment vanishes, student already
 * created something similar by hand — is a plain function call with plain data, which is why they
 * can all be tested directly rather than through a mocked API.
 *
 * The output is a *proposal*. Nothing here mutates anything. The student reviews it and chooses;
 * the store applies only what they picked.
 */
import {
  diffSchedules,
  formatClockTime,
  generateSchedule,
  normalizeDeadline,
  weekdayName,
  type GenerateScheduleInput,
  type ScheduleChangeSummary,
  type SchedulableWorkItem,
} from "@/scheduling-engine";
import { mergeImportedItem, type ExternalWorkItem } from "./import";
import type { NewWorkItemInput } from "./store";

/**
 * Identity of a piece of external coursework.
 *
 * Provider + course + coursework id, never the title (Part 10). Classroom coursework ids are unique
 * within a course rather than globally, so the course id is part of the key. A teacher renaming
 * "Chapter 7 Reading" to "Chapter 7 Reading — Updated" changes nothing here: it is the same item,
 * and it must not become a second one.
 */
export function externalKey(parts: { source?: string; externalCourseId?: string; externalId?: string }): string | null {
  if (!parts.source || !parts.externalId) return null;
  return `${parts.source}::${parts.externalCourseId ?? ""}::${parts.externalId}`;
}

/** One field the source changed since StudyFlow last looked. */
export interface SourceChange {
  field: "title" | "deadline" | "course";
  label: string;
  before: string;
  after: string;
}

export type ReconciledStatus = "new" | "unchanged" | "changed" | "undated";

export interface ReconciledItem {
  external: ExternalWorkItem;
  status: ReconciledStatus;
  /** The StudyFlow work item this corresponds to, once it has been imported. */
  existingId?: string;
  changes: SourceChange[];
  /**
   * Work the student created by hand that looks like this item. A warning shown at review time,
   * never an automatic merge (Part 11) — StudyFlow has no way to know whether these are the same
   * assignment, and the student does.
   */
  possibleManualDuplicates: { id: string; title: string }[];
}

/** A previously-imported item that Classroom no longer returns. */
export interface DisappearedItem {
  workItemId: string;
  title: string;
  courseName?: string;
}

export interface ReconcileResult {
  /** Not in StudyFlow yet, and Classroom gave a deadline. */
  newItems: ReconciledItem[];
  /** Not in StudyFlow yet, and Classroom gave no deadline — needs a date from the student. */
  undatedItems: ReconciledItem[];
  /** Already imported; the source changed something StudyFlow tracks. */
  changedItems: ReconciledItem[];
  /** Already imported; nothing moved. */
  unchangedItems: ReconciledItem[];
  /** Already imported; Classroom didn't return it this time. Never auto-deleted. */
  disappearedItems: DisappearedItem[];
}

export interface ReconcileInput {
  /** Everything retrieved this sync, already normalized. */
  external: ExternalWorkItem[];
  /** The student's current work items, imported and manual alike. */
  existing: SchedulableWorkItem[];
  /**
   * Courses whose coursework was retrieved **successfully** this run.
   *
   * Load-bearing: an item can only be called "no longer in Classroom" if StudyFlow actually managed
   * to look. Without this, one failed course request would report every assignment in that class as
   * disappeared — alarming, wrong, and exactly the kind of thing that makes a student stop trusting
   * a sync.
   */
  succeededCourseIds: string[];
}

/** Compares titles for the manual-duplicate warning: case, spacing and punctuation don't count. */
function comparableTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Friday at 3:00 PM" — enough to see a deadline move at a glance. */
export function formatDeadlineForChange(iso: string): string {
  const normalized = normalizeDeadline(iso);
  return `${weekdayName(normalized.slice(0, 10))} at ${formatClockTime(normalized)}`;
}

/**
 * Describes what the source changed, in the student's language rather than in field names.
 *
 * Derived from the same `mergeImportedItem` patch that will actually be applied, so the explanation
 * and the change can't drift apart — if it says the deadline moved, the deadline moved.
 */
function describeChanges(existing: SchedulableWorkItem, patch: Partial<NewWorkItemInput>): SourceChange[] {
  const previous = existing.sourceSnapshot;
  const changes: SourceChange[] = [];

  if (patch.title !== undefined) {
    changes.push({ field: "title", label: "Title changed", before: previous?.title ?? existing.title, after: patch.title });
  }
  if (patch.dueDate !== undefined) {
    const before = previous?.dueDate ?? existing.dueDate;
    changes.push({
      field: "deadline",
      label: "Deadline changed",
      before: formatDeadlineForChange(before),
      after: formatDeadlineForChange(patch.dueDate),
    });
  }
  if (patch.subject !== undefined) {
    changes.push({
      field: "course",
      label: "Class changed",
      before: previous?.courseName ?? existing.subject ?? "—",
      after: patch.subject ?? "—",
    });
  }
  return changes;
}

/**
 * Sorts a sync into what the student needs to decide about.
 *
 * Nothing is applied and nothing is mutated — this returns a description of the situation. The
 * three guarantees it is built to keep:
 *
 *  - **No duplicates.** Matching is by external identity, so re-syncing the same coursework a
 *    hundred times produces the same one work item.
 *  - **No resurrection.** An item StudyFlow has already imported is never offered as "new" again,
 *    whatever the student has since done with it — completed, edited, decomposed, or deleted-and-
 *    reimported.
 *  - **No silent deletion.** Coursework that vanished from Classroom is reported, not removed. The
 *    student may well have already done the work, and their sessions and history are theirs.
 */
export function reconcileCoursework({ external, existing, succeededCourseIds }: ReconcileInput): ReconcileResult {
  const existingByKey = new Map<string, SchedulableWorkItem>();
  for (const item of existing) {
    const key = externalKey(item);
    if (key) existingByKey.set(key, item);
  }

  const manualItems = existing.filter((item) => !item.source || item.source === "manual");

  const result: ReconcileResult = {
    newItems: [],
    undatedItems: [],
    changedItems: [],
    unchangedItems: [],
    disappearedItems: [],
  };

  const seenKeys = new Set<string>();

  for (const item of external) {
    const key = externalKey(item);
    if (!key) continue; // no stable identity — can't be tracked, so it isn't offered
    seenKeys.add(key);

    const match = existingByKey.get(key);

    if (!match) {
      const comparable = comparableTitle(item.title);
      const possibleManualDuplicates = manualItems
        .filter((m) => comparableTitle(m.title) === comparable)
        .map((m) => ({ id: m.id, title: m.title }));

      const reconciled: ReconciledItem = {
        external: item,
        // An item Classroom gave no deadline for is separated out rather than dropped or dated:
        // it's real work, it just can't be scheduled until someone says when it's for.
        status: item.dueDate ? "new" : "undated",
        changes: [],
        possibleManualDuplicates,
      };
      (reconciled.status === "new" ? result.newItems : result.undatedItems).push(reconciled);
      continue;
    }

    const patch = mergeImportedItem(match, item);
    if (!patch) {
      result.unchangedItems.push({ external: item, status: "unchanged", existingId: match.id, changes: [], possibleManualDuplicates: [] });
    } else {
      result.changedItems.push({
        external: item,
        status: "changed",
        existingId: match.id,
        changes: describeChanges(match, patch),
        possibleManualDuplicates: [],
      });
    }
  }

  const succeeded = new Set(succeededCourseIds);
  for (const item of existing) {
    const key = externalKey(item);
    if (!key || seenKeys.has(key)) continue;
    // Only courses StudyFlow actually managed to read can testify that something is gone.
    if (!item.externalCourseId || !succeeded.has(item.externalCourseId)) continue;
    result.disappearedItems.push({ workItemId: item.id, title: item.title, courseName: item.subject });
  }

  return result;
}

/** Everything the student could act on. Used to decide whether a sync is worth interrupting them for. */
export function actionableCount(result: ReconcileResult): number {
  return result.newItems.length + result.undatedItems.length + result.changedItems.length;
}

/**
 * The counts behind the "Classroom synced" summary (Phase 5C, Part 2/4).
 *
 * A plain tally over `ReconcileResult` — nothing here is estimated or rounded. Kept as its own
 * function rather than inlined in a component so the summary shown to the student and the numbers
 * asserted in tests are provably the same arithmetic.
 */
export interface ReconcileSummary {
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  /** Real coursework with no deadline yet — "needs a target date", not "new". */
  undatedCount: number;
  disappearedCount: number;
}

export function summarizeReconcile(result: ReconcileResult): ReconcileSummary {
  return {
    newCount: result.newItems.length,
    changedCount: result.changedItems.length,
    unchangedCount: result.unchangedItems.length,
    undatedCount: result.undatedItems.length,
    disappearedCount: result.disappearedItems.length,
  };
}

/**
 * The sentence describing which courses failed this sync, or `null` when none did.
 *
 * Named courses, not a bare count — "Biology couldn't be synced" tells the student which class to
 * check back on, where "1 course failed" does not. The three shapes below are all real outcomes,
 * not the same message with a number swapped in: one failing course among several successes reads
 * differently from every course failing at once.
 */
export function describeCourseFailures(failedCourseNames: string[], succeededCourseCount: number): string | null {
  if (failedCourseNames.length === 0) return null;

  if (succeededCourseCount === 0) {
    return failedCourseNames.length === 1
      ? `${failedCourseNames[0]} couldn't be synced, and no other courses were retrieved.`
      : "None of your courses could be synced right now.";
  }

  if (failedCourseNames.length === 1) {
    return `${failedCourseNames[0]} couldn't be synced. Your other courses were imported successfully.`;
  }

  return (
    `Classroom partially synced. ${succeededCourseCount} course${succeededCourseCount === 1 ? "" : "s"} synced ` +
    `successfully. ${failedCourseNames.length} course${failedCourseNames.length === 1 ? "" : "s"} couldn't be retrieved.`
  );
}

/**
 * "Last synced today at 4:32 PM" / "yesterday" / a date / "Never synced" (Phase 5C, Part 10).
 *
 * Deliberately never implies anything more current than the timestamp actually recorded — there is
 * no background sync, so a five-minute-old label and a five-day-old one both say exactly how old
 * they are rather than something reassuring like "up to date". `now` is a parameter rather than
 * read from the clock so this stays testable and deterministic like everything else in this module.
 */
export function formatSyncRecency(lastSyncAt: string | undefined, now: Date = new Date()): string {
  if (!lastSyncAt) return "Never synced";
  const date = new Date(lastSyncAt);
  if (Number.isNaN(date.getTime())) return "Never synced";

  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return `Last synced today at ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Last synced yesterday at ${time}`;

  return `Last synced ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/**
 * What this sync would do to the student's schedule, computed before anything is applied.
 *
 * Runs the **existing** scheduler twice — once on the current inputs, once on a throwaway copy with
 * the imports and updates applied — and diffs the two with the existing `diffSchedules`. There is
 * no Classroom-specific scheduling anywhere in this: the same engine, the same planning profile,
 * the same commitments, the same capacity and priority rules that produce the live plan produce
 * this preview, which is the only reason the preview can be trusted to match what happens next.
 *
 * Every line the student is shown therefore comes from real engine output. Nothing here composes a
 * plausible-sounding explanation.
 */
export function previewSyncImpact(
  input: GenerateScheduleInput,
  imports: NewWorkItemInput[],
  updates: { id: string; patch: Partial<NewWorkItemInput> }[]
): ScheduleChangeSummary {
  const patchById = new Map(updates.map((u) => [u.id, u.patch]));

  const projected: SchedulableWorkItem[] = [
    ...input.workItems.map((item) => {
      const patch = patchById.get(item.id);
      return patch ? ({ ...item, ...patch } as SchedulableWorkItem) : item;
    }),
    ...imports.map(
      (i, index) =>
        ({
          ...i,
          id: `preview_import_${index}`,
          userId: input.userId,
          status: "not-started",
          createdAt: input.now,
          updatedAt: input.now,
        }) as SchedulableWorkItem
    ),
  ];

  const before = generateSchedule(input);
  const after = generateSchedule({ ...input, workItems: projected });
  return diffSchedules(before.blocks, after.blocks);
}

/**
 * The patches to apply for the changes the student accepted.
 *
 * Re-derives each patch from `mergeImportedItem` rather than trusting anything the review UI
 * assembled, so what gets written is exactly what the source-owned-fields rule allows — no estimate,
 * importance, strictness, status, logged time, stage plan, or personalization preference can travel
 * through here, whatever the caller passes in.
 */
export function updatesForAcceptedChanges(
  result: ReconcileResult,
  acceptedExistingIds: string[],
  existing: SchedulableWorkItem[]
): { id: string; patch: Partial<NewWorkItemInput> }[] {
  const accepted = new Set(acceptedExistingIds);
  const byId = new Map(existing.map((item) => [item.id, item]));

  return result.changedItems
    .filter((item) => item.existingId && accepted.has(item.existingId))
    .flatMap((item) => {
      const match = byId.get(item.existingId!);
      if (!match) return [];
      const patch = mergeImportedItem(match, item.external);
      return patch ? [{ id: match.id, patch }] : [];
    });
}

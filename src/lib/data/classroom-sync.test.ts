import { describe, expect, it } from "vitest";
import {
  actionableCount,
  describeCourseFailures,
  externalKey,
  formatSyncRecency,
  previewSyncImpact,
  reconcileCoursework,
  summarizeReconcile,
  updatesForAcceptedChanges,
} from "./classroom-sync";
import { normalizeExternalItem, snapshotOf, type ExternalWorkItem } from "./import";
import type { NewWorkItemInput } from "./store";
import { generateSchedule, weekdayName, type SchedulableWorkItem } from "@/scheduling-engine";
import { makeAssignment, makePlanningProfile, NOW } from "@/scheduling-engine/__tests__/fixtures";

const TODAY = "2026-08-24";
const COURSE = "course-bio";

function coursework(overrides: Partial<ExternalWorkItem> = {}): ExternalWorkItem {
  return {
    source: "google-classroom",
    externalId: "cw-1",
    externalCourseId: COURSE,
    title: "Chapter 7 Reading",
    dueDate: "2026-08-28T23:59",
    courseName: "AP Biology",
    externalUrl: "https://classroom.google.com/c/course-bio/a/cw-1",
    workTypeHint: "assignment",
    sourceState: "active",
    ...overrides,
  };
}

/** A work item as it exists after being imported from the given coursework. */
function importedFrom(external: ExternalWorkItem, overrides: Partial<SchedulableWorkItem> = {}): SchedulableWorkItem {
  const input = normalizeExternalItem(external, TODAY)!;
  return {
    ...input,
    id: `item-${external.externalId}`,
    userId: "u1",
    status: "not-started",
    createdAt: "2026-08-24T08:00",
    updatedAt: "2026-08-24T08:00",
    ...overrides,
  } as SchedulableWorkItem;
}

function reconcile(external: ExternalWorkItem[], existing: SchedulableWorkItem[], succeeded: string[] = [COURSE]) {
  return reconcileCoursework({ external, existing, succeededCourseIds: succeeded });
}

describe("external identity", () => {
  it("is provider + course + coursework id, never the title", () => {
    expect(externalKey(coursework())).toBe("google-classroom::course-bio::cw-1");
  });

  it("is unchanged by a teacher renaming the assignment", () => {
    // "Chapter 7 Reading" → "Chapter 7 Reading — Updated" is the same item (Part 10).
    expect(externalKey(coursework({ title: "Chapter 7 Reading — Updated" }))).toBe(externalKey(coursework()));
  });

  it("distinguishes the same coursework id in two different courses", () => {
    expect(externalKey(coursework({ externalCourseId: "course-eng" }))).not.toBe(externalKey(coursework()));
  });

  it("is null for a manually created item, which has no external identity", () => {
    expect(externalKey({ source: undefined, externalId: undefined })).toBeNull();
  });
});

describe("reconciliation — what a sync means", () => {
  it("reports coursework StudyFlow has never seen as new", () => {
    const result = reconcile([coursework()], []);
    expect(result.newItems).toHaveLength(1);
    expect(result.newItems[0].external.title).toBe("Chapter 7 Reading");
    expect(result.changedItems).toHaveLength(0);
  });

  it("never offers an already-imported item as new again", () => {
    // The duplicate guarantee. Syncing the same coursework repeatedly must produce one work item.
    const external = coursework();
    const result = reconcile([external], [importedFrom(external)]);
    expect(result.newItems).toHaveLength(0);
    expect(result.unchangedItems).toHaveLength(1);
  });

  it("still recognizes an imported item after the student completed it", () => {
    // Part 20/21: completed work must not be resurrected as new on the next sync.
    const external = coursework();
    const done = importedFrom(external, { status: "completed", actualMinutes: 55 });
    const result = reconcile([external], [done]);
    expect(result.newItems).toHaveLength(0);
    expect(actionableCount(result)).toBe(0);
  });

  it("still recognizes an imported item after the teacher renamed it", () => {
    const original = coursework();
    const renamed = coursework({ title: "Chapter 7 Reading — Updated" });
    const result = reconcile([renamed], [importedFrom(original)]);

    expect(result.newItems).toHaveLength(0);
    expect(result.changedItems).toHaveLength(1);
    expect(result.changedItems[0].changes.map((c) => c.field)).toEqual(["title"]);
  });

  it("separates coursework with no deadline instead of dating it or dropping it", () => {
    const result = reconcile([coursework({ dueDate: undefined })], []);
    expect(result.newItems).toHaveLength(0);
    expect(result.undatedItems).toHaveLength(1);
    expect(result.undatedItems[0].status).toBe("undated");
  });

  it("reports a deadline change with both sides, in a form a student can read", () => {
    const original = coursework({ dueDate: "2026-08-28T23:59" }); // Friday
    const moved = coursework({ dueDate: "2026-08-27T15:00" }); // Thursday 3pm
    const result = reconcile([moved], [importedFrom(original)]);

    const change = result.changedItems[0].changes.find((c) => c.field === "deadline")!;
    expect(change.label).toBe("Deadline changed");
    expect(change.before).toBe("Friday at 11:59 PM");
    expect(change.after).toBe("Thursday at 3:00 PM");
  });

  it("reports a class rename as a class change", () => {
    const result = reconcile([coursework({ courseName: "Biology (Honors)" })], [importedFrom(coursework())]);
    expect(result.changedItems[0].changes.map((c) => c.field)).toEqual(["course"]);
  });

  it("says nothing changed when nothing changed", () => {
    const external = coursework();
    const result = reconcile([external], [importedFrom(external)]);
    expect(result.changedItems).toHaveLength(0);
    expect(result.unchangedItems).toHaveLength(1);
  });

  it("does not report the student's own edits as source changes", () => {
    // The student renamed their copy and rewrote the estimate. Classroom said nothing new.
    const external = coursework();
    const edited = importedFrom(external, { title: "Bio reading — do tonight", estimatedMinutes: 75, weight: "high" });
    expect(reconcile([external], [edited]).changedItems).toHaveLength(0);
  });
});

describe("coursework that disappeared", () => {
  it("reports a previously-imported item Classroom no longer returns", () => {
    const result = reconcile([], [importedFrom(coursework())]);
    expect(result.disappearedItems).toEqual([
      { workItemId: "item-cw-1", title: "Chapter 7 Reading", courseName: "AP Biology" },
    ]);
  });

  it("never deletes anything — it only reports", () => {
    // The result carries no removal instruction of any kind; the student decides.
    const result = reconcile([], [importedFrom(coursework())]);
    expect(Object.keys(result)).not.toContain("deletions");
    expect(result.disappearedItems[0].workItemId).toBe("item-cw-1");
  });

  it("does not call anything missing when its course failed to load", () => {
    // Load-bearing: one failed course request must not report that class's whole workload as gone.
    const result = reconcile([], [importedFrom(coursework())], []);
    expect(result.disappearedItems).toHaveLength(0);
  });

  it("leaves manually created work out of the disappeared list entirely", () => {
    const manual = makeAssignment({ title: "My own revision plan" });
    expect(reconcile([], [manual]).disappearedItems).toHaveLength(0);
  });
});

describe("existing manual work that resembles Classroom coursework", () => {
  it("warns rather than merging", () => {
    // Part 11: same title, different identity. StudyFlow cannot know these are the same, so it says
    // so and lets the student decide.
    const manual = makeAssignment({ id: "manual-1", title: "Chapter 7 Reading" });
    const result = reconcile([coursework()], [manual]);

    expect(result.newItems).toHaveLength(1);
    expect(result.newItems[0].possibleManualDuplicates).toEqual([{ id: "manual-1", title: "Chapter 7 Reading" }]);
  });

  it("matches loosely enough to be useful — case, spacing and punctuation don't count", () => {
    const manual = makeAssignment({ id: "manual-1", title: "chapter 7   reading!" });
    expect(reconcile([coursework()], [manual]).newItems[0].possibleManualDuplicates).toHaveLength(1);
  });

  it("does not warn about an unrelated assignment", () => {
    const manual = makeAssignment({ id: "manual-1", title: "History essay outline" });
    expect(reconcile([coursework()], [manual]).newItems[0].possibleManualDuplicates).toHaveLength(0);
  });

  it("never treats a previously-imported item as a manual duplicate of itself", () => {
    const other = coursework({ externalId: "cw-2", title: "Chapter 7 Reading" });
    const result = reconcile([other], [importedFrom(coursework())]);
    expect(result.newItems[0].possibleManualDuplicates).toHaveLength(0);
  });
});

describe("applying accepted changes", () => {
  it("produces a patch only for the changes the student ticked", () => {
    const a = coursework({ externalId: "cw-1" });
    const b = coursework({ externalId: "cw-2", title: "Lab writeup" });
    const existing = [importedFrom(a), importedFrom(b)];
    const result = reconcile(
      [coursework({ externalId: "cw-1", title: "Renamed A" }), coursework({ externalId: "cw-2", title: "Renamed B" })],
      existing
    );

    const updates = updatesForAcceptedChanges(result, ["item-cw-1"], existing);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: "item-cw-1" });
    expect(updates[0].patch.title).toBe("Renamed A");
  });

  it("produces nothing when the student accepted nothing", () => {
    const existing = [importedFrom(coursework())];
    const result = reconcile([coursework({ title: "Renamed" })], existing);
    expect(updatesForAcceptedChanges(result, [], existing)).toEqual([]);
  });

  it("can only ever write source-owned fields, whatever the caller asks for", () => {
    const existing = [importedFrom(coursework(), { estimatedMinutes: 150, weight: "high", status: "in-progress", actualMinutes: 40 })];
    const result = reconcile([coursework({ title: "Renamed" })], existing);
    const patch = updatesForAcceptedChanges(result, ["item-cw-1"], existing)[0].patch;

    for (const field of ["estimatedMinutes", "weight", "status", "actualMinutes", "deadlineStrictness", "workType"]) {
      expect(patch).not.toHaveProperty(field);
    }
  });
});

describe("schedule impact preview", () => {
  const scheduleInput = {
    userId: "u1",
    rangeStart: "2026-08-24",
    rangeEnd: "2026-08-28",
    now: NOW,
    workItems: [] as SchedulableWorkItem[],
    commitments: [],
    planningProfile: makePlanningProfile(),
  };

  it("reports the real sessions the engine would add for an import", () => {
    const input = normalizeExternalItem(coursework(), TODAY, { estimatedMinutes: 90 })!;
    const changes = previewSyncImpact(scheduleInput, [input], []);

    expect(changes.changes.length).toBeGreaterThan(0);
    expect(changes.changes.every((c) => c.kind === "added")).toBe(true);
    expect(changes.changes[0].title).toContain("Chapter 7 Reading");
  });

  it("reports no change when nothing is being imported or updated", () => {
    expect(previewSyncImpact(scheduleInput, [], []).changes).toEqual([]);
  });

  it("reports work moving when an accepted deadline change pulls it earlier", () => {
    // A deadline-driven student's sessions sit as late as the deadline allows, so moving the
    // deadline is exactly the case where the schedule visibly has to shift.
    const existing = importedFrom(coursework({ dueDate: "2026-08-28T23:59" }), { estimatedMinutes: 90 });
    const withItem = {
      ...scheduleInput,
      planningProfile: makePlanningProfile({ workStyle: "deadline_driven" }),
      workItems: [existing],
    };
    const moved = coursework({ dueDate: "2026-08-26T20:00" });
    const patch: Partial<NewWorkItemInput> = { dueDate: "2026-08-26T20:00", sourceSnapshot: snapshotOf(moved) };

    const changes = previewSyncImpact(withItem, [], [{ id: existing.id, patch }]);
    expect(changes.changes.some((c) => c.kind === "moved")).toBe(true);
  });

  it("leaves the caller's inputs untouched — the preview is run on a throwaway copy", () => {
    const existing = importedFrom(coursework());
    const withItem = { ...scheduleInput, workItems: [existing] };
    previewSyncImpact(withItem, [normalizeExternalItem(coursework({ externalId: "cw-9" }), TODAY)!], []);

    expect(withItem.workItems).toHaveLength(1);
    expect(withItem.workItems[0]).toBe(existing);
  });
});

describe("summarizeReconcile — the counts behind the sync summary (Phase 5C)", () => {
  it("tallies each bucket without double counting", () => {
    const existing = [importImportedForSummary()];
    const result = reconcile(
      [
        coursework({ externalId: "cw-1" }), // matches existing -> unchanged
        coursework({ externalId: "cw-2", title: "New item" }), // new
        coursework({ externalId: "cw-3", title: "New, no date", dueDate: undefined }), // undated
      ],
      existing
    );

    expect(summarizeReconcile(result)).toEqual({
      newCount: 1,
      changedCount: 0,
      unchangedCount: 1,
      undatedCount: 1,
      disappearedCount: 0,
    });
  });

  it("counts a disappeared item", () => {
    const result = reconcile([], [importedFrom(coursework())]);
    expect(summarizeReconcile(result).disappearedCount).toBe(1);
  });

  function importImportedForSummary() {
    return importedFrom(coursework({ externalId: "cw-1" }));
  }
});

describe("describeCourseFailures — naming what didn't sync", () => {
  it("returns null when nothing failed", () => {
    expect(describeCourseFailures([], 5)).toBeNull();
  });

  it("names the one course that failed among several successes", () => {
    expect(describeCourseFailures(["Biology"], 4)).toBe("Biology couldn't be synced. Your other courses were imported successfully.");
  });

  it("summarizes with counts when more than one course failed", () => {
    expect(describeCourseFailures(["Biology", "History"], 4)).toBe(
      "Classroom partially synced. 4 courses synced successfully. 2 courses couldn't be retrieved."
    );
  });

  it("uses singular wording for one success and one failure", () => {
    expect(describeCourseFailures(["Biology"], 0)).toBe("Biology couldn't be synced, and no other courses were retrieved.");
  });

  it("has a distinct message when every course failed", () => {
    expect(describeCourseFailures(["Biology", "History"], 0)).toBe("None of your courses could be synced right now.");
  });
});

describe("undated coursework that later gets a real Classroom deadline (Phase 5C, Part 8)", () => {
  /** What importing an undated item with a student-chosen target date actually produces. */
  function importedWithTargetDate(): SchedulableWorkItem {
    const undated = coursework({ dueDate: undefined });
    const input = normalizeExternalItem(undated, TODAY, { targetDate: "2026-09-12" })!;
    return {
      ...input,
      id: "item-cw-1",
      userId: "u1",
      status: "not-started",
      createdAt: "2026-08-24T08:00",
      updatedAt: "2026-08-24T08:00",
    } as SchedulableWorkItem;
  }

  it("imports against the student's target, recording no source deadline in the baseline", () => {
    const imported = importedWithTargetDate();
    expect(imported.dueDate).toBe("2026-09-12T23:59");
    expect(imported.deadlineStrictness).toBe("target");
    expect(imported.sourceSnapshot?.dueDate).toBeUndefined();
  });

  it("is detected as a deadline change, not silently applied", () => {
    const imported = importedWithTargetDate();
    const nowDated = coursework({ dueDate: "2026-09-04T15:00" });
    const result = reconcile([nowDated], [imported]);

    expect(result.changedItems).toHaveLength(1);
    const change = result.changedItems[0].changes.find((c) => c.field === "deadline")!;
    expect(change.before).toContain(weekdayName("2026-09-12"));
    expect(change.after).toContain(weekdayName("2026-09-04"));
  });

  it("does not overwrite the student's target until the change is accepted", () => {
    const imported = importedWithTargetDate();
    const nowDated = coursework({ dueDate: "2026-09-04T15:00" });
    const result = reconcile([nowDated], [imported]);

    expect(updatesForAcceptedChanges(result, [], [imported])).toEqual([]);
  });
});

describe("deselecting a Classroom course (Phase 5C, Part 12)", () => {
  it("leaves previously imported items from that course completely alone", () => {
    // Deselecting means "stop fetching updates", not "forget what was already imported" — modeled
    // here as the course simply not appearing in this sync's succeeded list, exactly like a
    // deselected course would.
    const imported = importedFrom(coursework(), { status: "in-progress", actualMinutes: 20, estimatedMinutes: 90 });
    const result = reconcile([], [imported], []);

    expect(result.disappearedItems).toEqual([]);
    expect(result.changedItems).toEqual([]);
    // The function is pure — it never mutates the item it was handed.
    expect(imported.status).toBe("in-progress");
    expect(imported.actualMinutes).toBe(20);
  });

  it("still schedules that work normally", () => {
    const imported = importedFrom(coursework(), { estimatedMinutes: 60 });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: TODAY,
      rangeEnd: "2026-08-28",
      now: NOW,
      workItems: [imported],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });
    expect(result.blocks.filter((b) => b.workItemId === imported.id).length).toBeGreaterThan(0);
  });
});

describe("formatSyncRecency (Phase 5C, Part 10)", () => {
  const NOW_DATE = new Date("2026-08-30T18:00:00");

  it("reports never synced when there's no timestamp", () => {
    expect(formatSyncRecency(undefined, NOW_DATE)).toBe("Never synced");
  });

  it("reports never synced for a malformed timestamp rather than throwing", () => {
    expect(formatSyncRecency("not-a-date", NOW_DATE)).toBe("Never synced");
  });

  it("says 'today' for a sync earlier the same day, with the time", () => {
    expect(formatSyncRecency("2026-08-30T16:32:00", NOW_DATE)).toMatch(/^Last synced today at /);
  });

  it("says 'yesterday' for a sync the previous calendar day", () => {
    expect(formatSyncRecency("2026-08-29T22:00:00", NOW_DATE)).toMatch(/^Last synced yesterday at /);
  });

  it("falls back to a plain date further back, without implying it's current", () => {
    const label = formatSyncRecency("2026-08-20T10:00:00", NOW_DATE);
    expect(label).toMatch(/^Last synced /);
    expect(label).not.toMatch(/today|yesterday/);
  });

  it("never claims real-time sync — every branch is explicitly in the past", () => {
    for (const iso of ["2026-08-30T16:32:00", "2026-08-29T22:00:00", "2026-08-20T10:00:00"]) {
      expect(formatSyncRecency(iso, NOW_DATE)).not.toMatch(/just now|live|real.?time/i);
    }
  });
});

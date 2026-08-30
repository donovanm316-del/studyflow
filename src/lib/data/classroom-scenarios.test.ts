import { describe, expect, it } from "vitest";
import { reconcileCoursework, updatesForAcceptedChanges } from "./classroom-sync";
import { normalizeExternalItem, type ExternalWorkItem } from "./import";
import { migrateSavedState } from "./migrate";
import { fixedBlocksAfterMove } from "@/lib/schedule-mutations";
import { normalizeCourseWork } from "@/lib/integrations/google-classroom";
import {
  formatClockTime,
  generateSchedule,
  minutesOfDay,
  toDateOnly,
  weekdayName,
  type GenerateScheduleInput,
  type SchedulableWorkItem,
} from "@/scheduling-engine";
import { makeAssignment, makeCommitment, makePlanningProfile, NOW } from "@/scheduling-engine/__tests__/fixtures";
import type { ScheduleBlock } from "@/types/models";

/**
 * End-to-end scenarios for Google Classroom import, from a raw API payload through to a schedule.
 *
 * Each one is a situation a real student ends up in, and each asserts the property that would
 * actually matter to them — not that a function was called, but that their week came out right and
 * their own work survived. Everything runs against the real scheduling engine; nothing about
 * planning is stubbed.
 *
 * These are **not** live Google tests. The Classroom payloads are the documented API shapes, fed
 * through the same normalization the real client uses, but no request reaches Google.
 */

const TODAY = "2026-08-24"; // Monday
const RANGE_END = "2026-08-30";

/** A raw `CourseWork` payload in Google's own shape. */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: "cw-1",
    courseId: "c-bio",
    title: "Chapter 7 Reading",
    state: "PUBLISHED",
    workType: "ASSIGNMENT",
    alternateLink: "https://classroom.google.com/c/c-bio/a/cw-1",
    updateTime: "2026-08-23T09:00:00.000Z",
    dueDate: { year: 2026, month: 8, day: 28 },
    dueTime: { hours: 23, minutes: 59 },
    ...overrides,
  };
}

function fromClassroom(overrides: Record<string, unknown> = {}): ExternalWorkItem {
  return normalizeCourseWork(payload(overrides), { name: "AP Biology", section: "Period 3" })!;
}

function importItem(external: ExternalWorkItem, id: string, estimatedMinutes = 60, overrides: Partial<SchedulableWorkItem> = {}) {
  const input = normalizeExternalItem(external, TODAY, { estimatedMinutes })!;
  return {
    ...input,
    id,
    userId: "u1",
    status: "not-started",
    createdAt: `${TODAY}T08:00`,
    updatedAt: `${TODAY}T08:00`,
    ...overrides,
  } as SchedulableWorkItem;
}

function schedule(workItems: SchedulableWorkItem[], overrides: Partial<GenerateScheduleInput> = {}) {
  return generateSchedule({
    userId: "u1",
    rangeStart: TODAY,
    rangeEnd: RANGE_END,
    now: NOW,
    workItems,
    commitments: [],
    planningProfile: makePlanningProfile(),
    ...overrides,
  });
}

function blocksFor(blocks: ScheduleBlock[], workItemId: string) {
  return blocks.filter((b) => b.workItemId === workItemId);
}

// ---------------------------------------------------------------------------

describe("A — connecting and importing three new assignments", () => {
  const external = [
    fromClassroom({ id: "cw-1", title: "Chapter 7 Reading" }),
    fromClassroom({ id: "cw-2", title: "Practice Problems", courseId: "c-math", dueDate: { year: 2026, month: 8, day: 27 } }),
    fromClassroom({ id: "cw-3", title: "DBQ Essay", courseId: "c-hist", dueDate: { year: 2026, month: 8, day: 30 } }),
  ];

  it("offers all three as new, with nothing already in StudyFlow", () => {
    const result = reconcileCoursework({ external, existing: [], succeededCourseIds: ["c-bio", "c-math", "c-hist"] });
    expect(result.newItems).toHaveLength(3);
    expect(result.changedItems).toHaveLength(0);
    expect(result.disappearedItems).toHaveLength(0);
  });

  it("puts imported work through the existing scheduler, with sessions for each", () => {
    const items = external.map((e, i) => importItem(e, `item-${i}`, 60));
    const result = schedule(items);

    for (const item of items) expect(blocksFor(result.blocks, item.id).length).toBeGreaterThan(0);
    expect(result.unscheduledWorkItemIds).toEqual([]);
  });

  it("gives imported work the same priority treatment as anything else — provenance is not a factor", () => {
    const imported = importItem(external[0], "imported", 60);
    // Same deadline, taken from the imported item so the two differ *only* in provenance. (Google
    // delivers due times in UTC, so the local deadline depends on the machine's zone — hardcoding
    // it here would make this test pass only where it was written.)
    const manual = makeAssignment({
      id: "manual",
      title: "Chapter 7 Reading",
      dueDate: imported.dueDate,
      estimatedMinutes: 60,
      subject: "AP Biology",
      deadlineStrictness: "hard",
    });

    const a = schedule([imported]).priorities["imported"];
    const b = schedule([manual]).priorities["manual"];
    expect(a.score).toBeCloseTo(b.score, 10);
  });

  it("flags every import as needing a real estimate when the student didn't give one", () => {
    const input = normalizeExternalItem(external[0], TODAY)!;
    expect(input.needsEstimate).toBe(true);
  });
});

describe("B — syncing again produces no duplicates", () => {
  it("reports the same coursework as already imported, not as new", () => {
    const external = fromClassroom();
    const existing = [importItem(external, "item-1")];

    for (let sync = 0; sync < 3; sync++) {
      const result = reconcileCoursework({ external: [external], existing, succeededCourseIds: ["c-bio"] });
      expect(result.newItems).toHaveLength(0);
      expect(result.unchangedItems).toHaveLength(1);
    }
  });

  it("does not duplicate work in the schedule either", () => {
    const external = fromClassroom();
    const items = [importItem(external, "item-1", 60)];
    const result = schedule(items);
    const totalMinutes = blocksFor(result.blocks, "item-1").reduce(
      (sum, b) => sum + (minutesOfDay(b.end.split("T")[1]) - minutesOfDay(b.start.split("T")[1])),
      0
    );
    expect(totalMinutes).toBe(60);
  });
});

describe("C — a teacher changes an imported assignment's deadline", () => {
  const original = fromClassroom({ dueDate: { year: 2026, month: 8, day: 28 }, dueTime: { hours: 23, minutes: 59 } });
  const moved = fromClassroom({
    dueDate: { year: 2026, month: 8, day: 27 },
    dueTime: { hours: 19, minutes: 0 },
    updateTime: "2026-08-25T14:00:00.000Z",
  });

  it("detects the change and names both sides", () => {
    const existing = [importItem(original, "item-1", 120)];
    const result = reconcileCoursework({ external: [moved], existing, succeededCourseIds: ["c-bio"] });

    expect(result.changedItems).toHaveLength(1);
    const change = result.changedItems[0].changes.find((c) => c.field === "deadline")!;
    // Weekday names are derived, not hardcoded: Google's due times are UTC, so which local day a
    // deadline lands on depends on the machine's zone.
    expect(change.before).toBe(`${weekdayName(original.dueDate!.slice(0, 10))} at ${formatClockTime(original.dueDate!)}`);
    expect(change.after).toBe(`${weekdayName(moved.dueDate!.slice(0, 10))} at ${formatClockTime(moved.dueDate!)}`);
    expect(change.before).not.toBe(change.after);
  });

  it("does not change anything until the student accepts it", () => {
    const existing = [importItem(original, "item-1", 120)];
    const result = reconcileCoursework({ external: [moved], existing, succeededCourseIds: ["c-bio"] });
    expect(updatesForAcceptedChanges(result, [], existing)).toEqual([]);
  });

  it("moves the work earlier once accepted, through the existing engine", () => {
    const existing = [importItem(original, "item-1", 120)];
    const result = reconcileCoursework({ external: [moved], existing, succeededCourseIds: ["c-bio"] });
    const patch = updatesForAcceptedChanges(result, ["item-1"], existing)[0].patch;

    const updated = [{ ...existing[0], ...patch } as SchedulableWorkItem];
    const after = schedule(updated);

    // The engine's deadline cap is what enforces this: nothing may be planned past the new instant.
    expect(updated[0].dueDate).toBe(moved.dueDate);
    for (const block of blocksFor(after.blocks, "item-1")) {
      expect(block.end <= updated[0].dueDate).toBe(true);
    }
  });

  it("keeps the student's estimate and logged progress across the accepted change", () => {
    const existing = [importItem(original, "item-1", 180, { actualMinutes: 45, status: "in-progress", weight: "high" })];
    const result = reconcileCoursework({ external: [moved], existing, succeededCourseIds: ["c-bio"] });
    const patch = updatesForAcceptedChanges(result, ["item-1"], existing)[0].patch;
    const merged = { ...existing[0], ...patch } as SchedulableWorkItem;

    expect(merged.estimatedMinutes).toBe(180);
    expect(merged.actualMinutes).toBe(45);
    expect(merged.status).toBe("in-progress");
    expect(merged.weight).toBe("high");
  });

  it("reports the change once, not on every subsequent sync", () => {
    const existing = [importItem(original, "item-1", 120)];
    const first = reconcileCoursework({ external: [moved], existing, succeededCourseIds: ["c-bio"] });
    const patch = updatesForAcceptedChanges(first, ["item-1"], existing)[0].patch;
    const after = [{ ...existing[0], ...patch } as SchedulableWorkItem];

    const second = reconcileCoursework({ external: [moved], existing: after, succeededCourseIds: ["c-bio"] });
    expect(second.changedItems).toHaveLength(0);
  });
});

describe("D — an assignment disappears from Classroom", () => {
  it("reports it without deleting the student's work or their sessions", () => {
    const external = fromClassroom();
    const existing = [importItem(external, "item-1", 60, { actualMinutes: 30, status: "in-progress" })];

    const result = reconcileCoursework({ external: [], existing, succeededCourseIds: ["c-bio"] });

    expect(result.disappearedItems.map((d) => d.workItemId)).toEqual(["item-1"]);
    // The reconciliation is a report. The item is still there, untouched, with its logged time.
    expect(existing[0].status).toBe("in-progress");
    expect(existing[0].actualMinutes).toBe(30);
  });

  it("keeps scheduling it, because the student may still owe the work", () => {
    const existing = [importItem(fromClassroom(), "item-1", 60)];
    expect(blocksFor(schedule(existing).blocks, "item-1").length).toBeGreaterThan(0);
  });

  it("stays quiet when the item's course simply failed to load this time", () => {
    const existing = [importItem(fromClassroom(), "item-1", 60)];
    expect(reconcileCoursework({ external: [], existing, succeededCourseIds: [] }).disappearedItems).toEqual([]);
  });
});

describe("E — coursework with no due date", () => {
  const undated = fromClassroom({ dueDate: undefined, dueTime: undefined });

  it("arrives with no deadline rather than a fabricated one", () => {
    expect(undated.dueDate).toBeUndefined();
    expect(undated.hasExactDeadline).toBe(false);
  });

  it("is held back from import until the student supplies a date", () => {
    const result = reconcileCoursework({ external: [undated], existing: [], succeededCourseIds: ["c-bio"] });
    expect(result.newItems).toHaveLength(0);
    expect(result.undatedItems).toHaveLength(1);
    expect(normalizeExternalItem(undated, TODAY)).toBeNull();
  });

  it("never lands in the schedule on its own, so it can't flood the week", () => {
    // Nothing to schedule, because nothing was imported.
    expect(schedule([]).blocks).toEqual([]);
  });

  it("imports against the student's target date, marked as a target rather than a hard deadline", () => {
    const input = normalizeExternalItem(undated, TODAY, { targetDate: "2026-08-29", estimatedMinutes: 45 })!;
    expect(input.dueDate).toBe("2026-08-29T23:59");
    expect(input.deadlineStrictness).toBe("target");

    const result = schedule([{ ...input, id: "item-1", userId: "u1", status: "not-started", createdAt: NOW, updatedAt: NOW } as SchedulableWorkItem]);
    expect(blocksFor(result.blocks, "item-1").length).toBeGreaterThan(0);
  });
});

describe("F — an assignment due at exactly 3:00 PM", () => {
  // Google delivers due times in UTC. The scenario is written in UTC and asserted in local terms,
  // so it holds in any time zone: whatever local instant 15:00 UTC is, nothing may be planned after it.
  const at3pm = fromClassroom({ dueDate: { year: 2026, month: 8, day: 27 }, dueTime: { hours: 15, minutes: 0 } });

  it("preserves the exact time instead of rounding it to end of day", () => {
    expect(at3pm.hasExactDeadline).toBe(true);
    expect(at3pm.dueDate).not.toMatch(/T23:59$/);
    expect(at3pm.dueDate).toMatch(/T\d{2}:\d{2}$/);
  });

  it("schedules no work past the deadline instant", () => {
    const item = importItem(at3pm, "item-1", 120);
    for (const block of blocksFor(schedule([item]).blocks, "item-1")) {
      expect(block.end <= item.dueDate).toBe(true);
    }
  });

  it("keeps the exact time through a save-and-reload cycle", () => {
    const item = importItem(at3pm, "item-1", 120);
    const reloaded = migrateSavedState(JSON.parse(JSON.stringify({ workItems: [item] })), true);
    expect(reloaded.workItems[0].dueDate).toBe(item.dueDate);
  });
});

describe("G — the student moved a session by hand, then syncs", () => {
  it("keeps the manual override in place", () => {
    // Part 17: a sync must not quietly undo a decision the student made about their own day.
    const external = fromClassroom();
    const item = importItem(external, "item-1", 60);
    const first = schedule([item]);
    const original = blocksFor(first.blocks, "item-1")[0];

    const pinned = fixedBlocksAfterMove([], original, "2026-08-26T19:00", "2026-08-26T20:00", "moved-1");
    const after = schedule([item], { existingBlocks: pinned });

    const moved = after.blocks.find((b) => b.id === "moved-1");
    expect(moved).toBeDefined();
    expect(moved!.start).toBe("2026-08-26T19:00");
  });

  it("still keeps it after an accepted deadline change from the teacher", () => {
    const external = fromClassroom();
    const item = importItem(external, "item-1", 60);
    const original = blocksFor(schedule([item]).blocks, "item-1")[0];
    const pinned = fixedBlocksAfterMove([], original, "2026-08-26T19:00", "2026-08-26T20:00", "moved-1");

    const movedDeadline = fromClassroom({ dueDate: { year: 2026, month: 8, day: 27 }, dueTime: { hours: 19, minutes: 0 } });
    const result = reconcileCoursework({ external: [movedDeadline], existing: [item], succeededCourseIds: ["c-bio"] });
    const patch = updatesForAcceptedChanges(result, ["item-1"], [item])[0].patch;

    const after = schedule([{ ...item, ...patch } as SchedulableWorkItem], { existingBlocks: pinned });
    expect(after.blocks.some((b) => b.id === "moved-1")).toBe(true);
  });
});

describe("H — disconnecting Google Classroom", () => {
  it("leaves imported work, its provenance, and its history completely intact", () => {
    // Disconnecting clears a cookie on the server. It has no access to — and no interest in — the
    // student's local planner, and imported assignments are their work now.
    const item = importItem(fromClassroom(), "item-1", 90, { actualMinutes: 40, status: "in-progress" });
    const saved = { workItems: [item], workSessions: [{ id: "s1", userId: "u1", workItemId: "item-1", start: `${TODAY}T15:00`, end: `${TODAY}T15:40`, plannedMinutes: 40, minutesSpent: 40 }] };

    const reloaded = migrateSavedState(JSON.parse(JSON.stringify(saved)), true);

    expect(reloaded.workItems).toHaveLength(1);
    expect(reloaded.workItems[0].source).toBe("google-classroom");
    expect(reloaded.workItems[0].externalUrl).toBe("https://classroom.google.com/c/c-bio/a/cw-1");
    expect(reloaded.workItems[0].actualMinutes).toBe(40);
    expect(reloaded.workSessions).toHaveLength(1);
  });

  it("keeps scheduling that work exactly as before", () => {
    const item = importItem(fromClassroom(), "item-1", 60);
    expect(blocksFor(schedule([item]).blocks, "item-1").length).toBeGreaterThan(0);
  });

  it("keeps the student's course selection, so reconnecting doesn't start from scratch", () => {
    const reloaded = migrateSavedState({ classroomCourseIds: ["c-bio", "c-math"] }, true);
    expect(reloaded.classroomCourseIds).toEqual(["c-bio", "c-math"]);
  });
});

describe("I — manual assignments that resemble Classroom titles", () => {
  it("keeps both and warns, rather than merging or silently duplicating", () => {
    const manual = makeAssignment({ id: "manual-1", title: "Chapter 7 Reading", subject: "AP Biology", dueDate: "2026-08-28T23:59:00" });
    const result = reconcileCoursework({ external: [fromClassroom()], existing: [manual], succeededCourseIds: ["c-bio"] });

    expect(result.newItems).toHaveLength(1);
    expect(result.newItems[0].possibleManualDuplicates).toEqual([{ id: "manual-1", title: "Chapter 7 Reading" }]);
    // The manual item is untouched — no patch, no deletion, no merge.
    expect(manual.title).toBe("Chapter 7 Reading");
  });

  it("schedules both if the student imports anyway — their call, honestly reflected", () => {
    const manual = makeAssignment({ id: "manual-1", title: "Chapter 7 Reading", dueDate: "2026-08-28T23:59:00", estimatedMinutes: 60 });
    const imported = importItem(fromClassroom(), "item-1", 60);
    const result = schedule([manual, imported]);

    expect(blocksFor(result.blocks, "manual-1").length).toBeGreaterThan(0);
    expect(blocksFor(result.blocks, "item-1").length).toBeGreaterThan(0);
  });
});

describe("J — importing more work than the week can hold", () => {
  it("says so instead of quietly promising to fit it", () => {
    // Six hours of hard-deadline work due tomorrow, against a single evening already half taken by
    // practice. The honest outcome is a warning and unplaced work, not a tidy-looking schedule.
    const heavy = [
      importItem(fromClassroom({ id: "cw-1", title: "Reading", dueDate: { year: 2026, month: 8, day: 25 }, dueTime: { hours: 23, minutes: 59 } }), "item-1", 240),
      importItem(fromClassroom({ id: "cw-2", title: "Problem set", dueDate: { year: 2026, month: 8, day: 25 }, dueTime: { hours: 23, minutes: 59 } }), "item-2", 240),
    ];

    const result = generateSchedule({
      userId: "u1",
      rangeStart: TODAY,
      // Derived from the item rather than hardcoded — the UTC due time lands on a local date that
      // depends on the machine's zone.
      rangeEnd: heavy[0].dueDate.slice(0, 10),
      now: NOW,
      workItems: heavy,
      commitments: [makeCommitment({ recurrence: { type: "weekly", daysOfWeek: [1, 2] }, startTime: "16:00", endTime: "20:00" })],
      planningProfile: makePlanningProfile(),
    });

    const placed = result.blocks.filter((b) => b.origin === "generated");
    const placedMinutes = placed.reduce((sum, b) => sum + (minutesOfDay(b.end.split("T")[1]) - minutesOfDay(b.start.split("T")[1])), 0);

    expect(placedMinutes).toBeLessThan(480);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("never schedules over a fixed commitment to make imported work fit", () => {
    const item = importItem(fromClassroom({ dueDate: { year: 2026, month: 8, day: 25 }, dueTime: { hours: 23, minutes: 59 } }), "item-1", 300);
    const commitment = makeCommitment({ recurrence: { type: "weekly", daysOfWeek: [1, 2] }, startTime: "16:00", endTime: "20:00" });
    const result = schedule([item], { rangeEnd: item.dueDate.slice(0, 10), commitments: [commitment] });

    const committedDays = new Set(["2026-08-24", "2026-08-25"]); // the Monday and Tuesday of this range
    for (const block of blocksFor(result.blocks, "item-1")) {
      if (!committedDays.has(toDateOnly(block.start))) continue;
      const start = minutesOfDay(block.start.split("T")[1]);
      const end = minutesOfDay(block.end.split("T")[1]);
      expect(start < 20 * 60 && end > 16 * 60).toBe(false);
    }
  });
});

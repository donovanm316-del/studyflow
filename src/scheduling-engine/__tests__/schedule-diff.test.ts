import { describe, expect, it } from "vitest";
import { diffSchedules } from "../schedule-diff";
import type { ScheduleBlock } from "@/types/models";

function block(overrides: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id: "b1",
    userId: "u1",
    workItemId: "item1",
    workItemKind: "assignment",
    title: "Biology",
    start: "2026-08-24T16:00",
    end: "2026-08-24T16:45",
    origin: "generated",
    status: "planned",
    ...overrides,
  };
}

describe("diffSchedules", () => {
  it("reports no changes for identical schedules", () => {
    const before = [block()];
    const after = [block()];
    expect(diffSchedules(before, after).changes).toEqual([]);
  });

  it("reports an added item that wasn't scheduled before", () => {
    const summary = diffSchedules([], [block()]);
    expect(summary.changes).toHaveLength(1);
    expect(summary.changes[0].kind).toBe("added");
    expect(summary.changes[0].title).toBe("Biology");
  });

  it("reports a removed item that no longer appears", () => {
    const summary = diffSchedules([block()], []);
    expect(summary.changes).toHaveLength(1);
    expect(summary.changes[0].kind).toBe("removed");
  });

  it("reports a moved item when its earliest date changes", () => {
    const before = [block({ start: "2026-08-24T16:00", end: "2026-08-24T16:45" })];
    const after = [block({ start: "2026-08-25T16:00", end: "2026-08-25T16:45" })];
    const summary = diffSchedules(before, after);
    expect(summary.changes).toHaveLength(1);
    expect(summary.changes[0].kind).toBe("moved");
  });

  it("reports a duration change when the day stays the same but total minutes differ", () => {
    const before = [block({ start: "2026-08-24T16:00", end: "2026-08-24T16:45" })]; // 45 min
    const after = [block({ start: "2026-08-24T16:00", end: "2026-08-24T16:30" })]; // 30 min
    const summary = diffSchedules(before, after);
    expect(summary.changes).toHaveLength(1);
    expect(summary.changes[0].kind).toBe("duration-changed");
  });

  it("aggregates a multi-session item's parts under one title before comparing", () => {
    const before = [
      block({ id: "b1", title: "Lab report (part 1)", start: "2026-08-24T16:00", end: "2026-08-24T16:45" }),
      block({ id: "b2", title: "Lab report (part 2)", start: "2026-08-25T16:00", end: "2026-08-25T16:45" }),
    ];
    const after = before; // unchanged
    expect(diffSchedules(before, after).changes).toEqual([]);
  });

  it("ignores skipped blocks and blocks without a work item (commitments/breaks)", () => {
    const before = [block({ status: "skipped" }), block({ id: "commit1", workItemId: undefined, title: "School", origin: "commitment" })];
    const after: ScheduleBlock[] = [];
    expect(diffSchedules(before, after).changes).toEqual([]);
  });

  it("does not report a change for a different, unrelated work item appearing unchanged", () => {
    const shared = block({ id: "b2", workItemId: "item2", title: "Math" });
    const before = [block(), shared];
    const after = [block(), shared];
    expect(diffSchedules(before, after).changes).toEqual([]);
  });
});

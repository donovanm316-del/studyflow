import { describe, expect, it } from "vitest";
import { changesSchedule, formatDueLabel } from "./schedule-format";
import type { NewWorkItemInput } from "@/lib/data/store";
import type { SchedulableWorkItem } from "@/scheduling-engine";

const TODAY = "2026-08-24";

describe("formatDueLabel — exact deadline times (Phase 4.5A)", () => {
  it("shows the time for something due today", () => {
    expect(formatDueLabel("2026-08-24T23:59", TODAY)).toBe("Due today at 11:59 PM");
  });

  it("shows the time for something due tomorrow", () => {
    expect(formatDueLabel("2026-08-25T15:00", TODAY)).toBe("Due tomorrow at 3:00 PM");
  });

  it("names the weekday, with the time, for something later this week", () => {
    expect(formatDueLabel("2026-08-26T08:00", TODAY)).toBe("Due Wednesday at 8:00 AM");
  });

  it("stays coarse beyond a week out, where exact times are noise", () => {
    expect(formatDueLabel("2026-09-05T23:59", TODAY)).toBe("Due in 12 days");
  });

  it("reports an overdue item with when it was actually due", () => {
    expect(formatDueLabel("2026-08-23T23:59", TODAY)).toBe("Overdue · was due yesterday at 11:59 PM");
    expect(formatDueLabel("2026-08-21T09:00", TODAY)).toBe("Overdue · was due 3 days ago at 9:00 AM");
  });

  it("renders midnight and noon correctly rather than as 0:00", () => {
    expect(formatDueLabel("2026-08-25T00:00", TODAY)).toBe("Due tomorrow at 12:00 AM");
    expect(formatDueLabel("2026-08-25T12:00", TODAY)).toBe("Due tomorrow at 12:00 PM");
  });

  it("treats a legacy date-only deadline as 11:59 PM (backward compatibility)", () => {
    expect(formatDueLabel("2026-08-25", TODAY)).toBe("Due tomorrow at 11:59 PM");
  });
});

function makeItem(dueDate: string): SchedulableWorkItem {
  return {
    kind: "assignment",
    id: "i1",
    userId: "u1",
    title: "Essay",
    dueDate,
    status: "not-started",
    estimatedMinutes: 60,
    weight: "medium",
    deadlineStrictness: "hard",
    workType: "homework",
    createdAt: "2026-08-20T08:00",
    updatedAt: "2026-08-20T08:00",
  };
}

function makeInput(dueDate: string): NewWorkItemInput {
  const item = makeItem(dueDate);
  return {
    kind: item.kind,
    title: item.title,
    dueDate,
    estimatedMinutes: item.estimatedMinutes,
    weight: item.weight,
    deadlineStrictness: item.deadlineStrictness,
    workType: item.workType,
  } as NewWorkItemInput;
}

describe("changesSchedule — deadline times", () => {
  it("treats a changed deadline time as a schedule-affecting edit", () => {
    expect(changesSchedule(makeItem("2026-08-25T23:59"), makeInput("2026-08-25T09:00"))).toBe(true);
  });

  it("does not report a change when a legacy date-only value gains its implied 11:59 PM", () => {
    expect(changesSchedule(makeItem("2026-08-25"), makeInput("2026-08-25T23:59"))).toBe(false);
  });
});

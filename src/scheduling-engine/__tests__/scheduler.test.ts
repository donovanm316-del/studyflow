import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { minutesOfDay, toDateOnly } from "../date-utils";
import type { ScheduleBlock } from "@/types/models";
import { makeAssignment, makeCommitment, makePlanningProfile, makeProject, makeTest, NOW } from "./fixtures";

function workBlocks(blocks: ScheduleBlock[]): ScheduleBlock[] {
  return blocks.filter((b) => b.origin === "generated");
}

function totalMinutes(blocks: ScheduleBlock[]): number {
  return blocks.reduce((sum, b) => sum + (minutesOfDay(b.end.split("T")[1]) - minutesOfDay(b.start.split("T")[1])), 0);
}

/** Fails if any two blocks on the same day overlap in time. */
function assertNoOverlaps(blocks: ScheduleBlock[]) {
  const byDay = new Map<string, ScheduleBlock[]>();
  for (const b of blocks) {
    const day = toDateOnly(b.start);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(b);
  }
  for (const [, dayBlocks] of byDay) {
    const sorted = [...dayBlocks].sort((a, b) => (a.start < b.start ? -1 : 1));
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].start >= sorted[i - 1].end).toBe(true);
    }
  }
}

describe("generateSchedule — basic placement", () => {
  it("does not schedule work over a fixed commitment", () => {
    const commitment = makeCommitment({ recurrence: { type: "weekly", daysOfWeek: [1] }, startTime: "16:00", endTime: "18:00" });
    const item = makeAssignment({ dueDate: "2026-08-25T23:59:00", estimatedMinutes: 300, deadlineStrictness: "hard" });

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-25",
      now: NOW,
      workItems: [item],
      commitments: [commitment],
      planningProfile: makePlanningProfile(),
    });

    const monday = workBlocks(result.blocks).filter((b) => toDateOnly(b.start) === "2026-08-24");
    for (const block of monday) {
      const start = minutesOfDay(block.start.split("T")[1]);
      const end = minutesOfDay(block.end.split("T")[1]);
      const overlapsCommitment = start < 18 * 60 && end > 16 * 60;
      expect(overlapsCommitment).toBe(false);
    }
    assertNoOverlaps(result.blocks);
  });

  it("never schedules work outside the profile's daily availability window", () => {
    const item = makeAssignment({ dueDate: "2026-08-26T23:59:00", estimatedMinutes: 400, deadlineStrictness: "hard" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-26",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    for (const block of workBlocks(result.blocks)) {
      const start = minutesOfDay(block.start.split("T")[1]);
      const end = minutesOfDay(block.end.split("T")[1]);
      expect(start).toBeGreaterThanOrEqual(15 * 60);
      expect(end).toBeLessThanOrEqual(21 * 60);
    }
  });

  it("splits a large project across multiple days instead of one giant block", () => {
    const project = makeProject({ estimatedMinutes: 240, dueDate: "2026-08-28T23:59:00" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-28",
      now: NOW,
      workItems: [project],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    const projectBlocks = workBlocks(result.blocks).filter((b) => b.workItemId === project.id);
    const days = new Set(projectBlocks.map((b) => toDateOnly(b.start)));
    expect(projectBlocks.length).toBeGreaterThan(1);
    expect(days.size).toBeGreaterThan(1);
    assertNoOverlaps(result.blocks);
  });

  it("inserts a break between two sessions of the same item packed into one window, not just between different items", () => {
    // A single big item whose two sessions land in the same day's window should still get a
    // real break between them — otherwise two 60-minute chunks back-to-back are just one
    // uninterrupted 120-minute session, which defeats the point of splitting by session length.
    const item = makeAssignment({
      title: "Long reading",
      workType: "long-term",
      estimatedMinutes: 100,
      dueDate: "2026-08-24T23:59:00",
      deadlineStrictness: "hard",
    });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile({ workloadTolerance: "heavy", breakPreference: "balanced" }),
    });

    const itemBlocks = workBlocks(result.blocks)
      .filter((b) => b.workItemId === item.id)
      .sort((a, b) => (a.start < b.start ? -1 : 1));
    expect(itemBlocks.length).toBeGreaterThan(1);

    const gapMinutes = minutesOfDay(itemBlocks[1].start.split("T")[1]) - minutesOfDay(itemBlocks[0].end.split("T")[1]);
    expect(gapMinutes).toBeGreaterThan(0);

    const breakBetween = result.blocks.find(
      (b) => b.origin === "break" && b.start === itemBlocks[0].end && b.end === itemBlocks[1].start
    );
    expect(breakBetween).toBeDefined();
  });

  it("schedules multiple assignments without any overlapping blocks", () => {
    const a = makeAssignment({ title: "A", dueDate: "2026-08-25T23:59:00", estimatedMinutes: 60 });
    const b = makeAssignment({ title: "B", dueDate: "2026-08-25T23:59:00", estimatedMinutes: 60, weight: "high" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-25",
      now: NOW,
      workItems: [a, b],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(result.unscheduledWorkItemIds).toHaveLength(0);
    assertNoOverlaps(result.blocks);
  });

  it("respects a hard deadline when there is enough capacity to meet it", () => {
    const item = makeTest({ dueDate: "2026-08-26T23:59:00", estimatedMinutes: 90, deadlineStrictness: "hard" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-27",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(result.unscheduledWorkItemIds).not.toContain(item.id);
    const blocks = workBlocks(result.blocks).filter((b) => b.workItemId === item.id);
    expect(blocks.every((b) => toDateOnly(b.start) <= "2026-08-26")).toBe(true);
  });

  it("does not let a big, less-urgent item starve a tiny item due tomorrow of every day's capacity", () => {
    // A big, high-scoring test due in 3 days should NOT be allowed to consume so much of the
    // shared daily capacity (today and tomorrow) that a tiny 30-minute assignment due tomorrow
    // never gets placed at all.
    const bigLessUrgent = makeTest({
      title: "Unit Test",
      dueDate: "2026-08-27T23:59:00", // 3 days out
      estimatedMinutes: 120,
      weight: "high",
      deadlineStrictness: "hard",
    });
    const tinyUrgent = makeAssignment({
      title: "Tiny reading",
      dueDate: "2026-08-25T23:59:00", // tomorrow
      estimatedMinutes: 30,
      weight: "low",
      deadlineStrictness: "hard",
    });

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-30",
      now: NOW,
      workItems: [bigLessUrgent, tinyUrgent],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(result.unscheduledWorkItemIds).not.toContain(tinyUrgent.id);
    assertNoOverlaps(result.blocks);
  });

  it("preserves a manual-override block and schedules around it", () => {
    const manual: ScheduleBlock = {
      id: "manual1",
      userId: "u1",
      title: "Moved study block",
      start: "2026-08-24T15:00",
      end: "2026-08-24T16:00",
      origin: "manual-override",
      status: "planned",
    };
    const item = makeAssignment({ dueDate: "2026-08-24T23:59:00", estimatedMinutes: 300, deadlineStrictness: "hard" });

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
      existingBlocks: [manual],
    });

    expect(result.blocks.find((b) => b.id === "manual1")).toEqual(manual);
    assertNoOverlaps(result.blocks);
  });
});

describe("generateSchedule — student preferences shape the schedule", () => {
  const item = makeAssignment({ title: "Reading", dueDate: "2026-08-26T23:59:00", estimatedMinutes: 500, deadlineStrictness: "flexible" });

  it("produces a lighter total workload for 'light' tolerance than 'heavy'", () => {
    const light = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-26",
      now: NOW,
      workItems: [{ ...item }],
      commitments: [],
      planningProfile: makePlanningProfile({ workloadTolerance: "light" }),
    });
    const heavy = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-26",
      now: NOW,
      workItems: [{ ...item }],
      commitments: [],
      planningProfile: makePlanningProfile({ workloadTolerance: "heavy" }),
    });

    expect(totalMinutes(workBlocks(light.blocks))).toBeLessThan(totalMinutes(workBlocks(heavy.blocks)));
  });

  it("keeps individual sessions shorter for 'frequent' breaks than 'minimal'", () => {
    const frequent = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [{ ...item, estimatedMinutes: 500, dueDate: "2026-08-24T23:59:00" }],
      commitments: [],
      planningProfile: makePlanningProfile({ breakPreference: "frequent", workloadTolerance: "heavy" }),
    });
    const minimal = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [{ ...item, estimatedMinutes: 500, dueDate: "2026-08-24T23:59:00" }],
      commitments: [],
      planningProfile: makePlanningProfile({ breakPreference: "minimal", workloadTolerance: "heavy" }),
    });

    const longestFrequent = Math.max(...workBlocks(frequent.blocks).map((b) => minutesOfDay(b.end.split("T")[1]) - minutesOfDay(b.start.split("T")[1])));
    const longestMinimal = Math.max(...workBlocks(minimal.blocks).map((b) => minutesOfDay(b.end.split("T")[1]) - minutesOfDay(b.start.split("T")[1])));

    expect(longestFrequent).toBeLessThanOrEqual(40);
    expect(longestMinimal).toBeGreaterThan(longestFrequent);
  });

  it("protects more free time for high free-time-priority than low", () => {
    const high = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-26",
      now: NOW,
      workItems: [{ ...item }],
      commitments: [],
      planningProfile: makePlanningProfile({ freeTimePriority: "high" }),
    });
    const low = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-26",
      now: NOW,
      workItems: [{ ...item }],
      commitments: [],
      planningProfile: makePlanningProfile({ freeTimePriority: "low" }),
    });

    expect(totalMinutes(workBlocks(high.blocks))).toBeLessThan(totalMinutes(workBlocks(low.blocks)));
  });
});

describe("generateSchedule — edge cases", () => {
  it("returns an empty, caught-up schedule when there are no assignments", () => {
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-28",
      now: NOW,
      workItems: [],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(workBlocks(result.blocks)).toHaveLength(0);
    expect(result.caughtUp).toBe(true);
    expect(result.unscheduledWorkItemIds).toHaveLength(0);
  });

  it("leaves work unscheduled when there is no available time at all", () => {
    const item = makeAssignment({ dueDate: "2026-08-25T23:59:00", estimatedMinutes: 60 });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-25",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile({ dailyAvailability: [] }),
    });

    expect(result.unscheduledWorkItemIds).toContain(item.id);
    expect(workBlocks(result.blocks)).toHaveLength(0);
  });

  it("does not manufacture work when the student is already fully caught up", () => {
    const done = makeAssignment({ status: "completed", actualMinutes: 60, estimatedMinutes: 60 });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-28",
      now: NOW,
      workItems: [done],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(workBlocks(result.blocks)).toHaveLength(0);
    expect(result.caughtUp).toBe(true);
  });

  it("flags an item that needs more time than exists before its deadline", () => {
    const item = makeAssignment({
      dueDate: "2026-08-24T23:59:00",
      estimatedMinutes: 10000,
      deadlineStrictness: "hard",
    });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(result.unscheduledWorkItemIds).toContain(item.id);
    expect(result.warnings.some((w) => w.kind === "unscheduled-hard-deadline")).toBe(true);
  });

  it("detects an overloaded range honestly instead of pretending everything fits", () => {
    const items = [
      makeAssignment({ dueDate: "2026-08-25T23:59:00", estimatedMinutes: 400, deadlineStrictness: "flexible" }),
      makeTest({ dueDate: "2026-08-25T23:59:00", estimatedMinutes: 400, deadlineStrictness: "hard" }),
    ];
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-25",
      now: NOW,
      workItems: items,
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(result.warnings.some((w) => w.kind === "overloaded-range")).toBe(true);
  });

  it("prioritizes an overdue item over everything else", () => {
    const overdue = makeAssignment({ title: "Overdue", dueDate: "2026-08-20T23:59:00", estimatedMinutes: 60 });
    const upcoming = makeAssignment({ title: "Upcoming", dueDate: "2026-08-30T23:59:00", estimatedMinutes: 60, weight: "low" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [overdue, upcoming],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(result.priorities[overdue.id].score).toBeGreaterThan(result.priorities[upcoming.id].score);
  });

  it("excludes a completed item entirely rather than treating it as unscheduled", () => {
    const item = makeAssignment({ status: "completed", actualMinutes: 60, estimatedMinutes: 60, dueDate: "2026-08-20T23:59:00" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(result.unscheduledWorkItemIds).not.toContain(item.id);
    expect(workBlocks(result.blocks).some((b) => b.workItemId === item.id)).toBe(false);
  });
});

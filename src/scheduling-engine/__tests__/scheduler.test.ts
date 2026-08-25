import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { minutesOfDay, toDateOnly } from "../date-utils";
import type { ScheduleBlock } from "@/types/models";
import { makeAssignment, makeCommitment, makeFeedback, makePlanningProfile, makeProject, makeTest, NOW } from "./fixtures";

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

  it("'early' work style spreads a multi-day item across the days available instead of cramming it all into today", () => {
    // Reported scenario: a 120-minute test due in 3 days, under the default 'early' work style,
    // was landing almost entirely on day one (~90 of 120 minutes) even though 3 more days were
    // free — technically "early" but not "spread out". It should now use no more than
    // EARLY_FRONT_LOAD_FACTOR (1.5x) of an even day-split on any single day.
    const test = makeTest({ estimatedMinutes: 120, dueDate: "2026-08-27T23:59:00", deadlineStrictness: "hard" }); // 3 days out
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-27",
      now: NOW,
      workItems: [test],
      commitments: [],
      planningProfile: makePlanningProfile({ workStyle: "early" }),
    });

    const testBlocksByDay = new Map<string, number>();
    for (const b of workBlocks(result.blocks).filter((b) => b.workItemId === test.id)) {
      const day = toDateOnly(b.start);
      const duration = minutesOfDay(b.end.split("T")[1]) - minutesOfDay(b.start.split("T")[1]);
      testBlocksByDay.set(day, (testBlocksByDay.get(day) ?? 0) + duration);
    }

    expect(testBlocksByDay.size).toBeGreaterThan(1); // actually spread across more than one day
    for (const minutesOnDay of testBlocksByDay.values()) {
      expect(minutesOnDay).toBeLessThanOrEqual(Math.ceil((120 / 4) * 1.5)); // even-split * front-load factor
    }
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

describe("generateSchedule — deadline strictness actually affects outcomes", () => {
  it("keeps a hard-deadline item scheduled ahead of a same-priority flexible one when capacity is too tight for both", () => {
    // Identical in every way except strictness. There's only enough capacity for one of them.
    const hard = makeAssignment({
      title: "Hard",
      dueDate: "2026-08-24T23:59:00",
      estimatedMinutes: 120,
      weight: "medium",
      deadlineStrictness: "hard",
    });
    const flexible = makeAssignment({
      title: "Flexible",
      dueDate: "2026-08-24T23:59:00",
      estimatedMinutes: 120,
      weight: "medium",
      deadlineStrictness: "flexible",
    });

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [hard, flexible],
      commitments: [],
      // Moderate capacity (135 min) comfortably fits the 120-min hard item but leaves only 15
      // min for the flexible one — enough to prove one wins and the other doesn't, without also
      // starving the hard item itself (which "light" tolerance's 75 min would have done).
      planningProfile: makePlanningProfile({ workloadTolerance: "moderate" }),
    });

    expect(result.unscheduledWorkItemIds).not.toContain(hard.id);
    expect(result.unscheduledWorkItemIds).toContain(flexible.id);
    // A dropped flexible item should never trigger the hard-deadline warning — it's allowed to slip.
    expect(result.warnings.find((w) => w.kind === "unscheduled-hard-deadline")?.workItemIds ?? []).not.toContain(
      flexible.id
    );
  });

  it("treats a 'target' deadline as movable, the same as flexible, under tight capacity", () => {
    const hard = makeAssignment({
      title: "Hard",
      dueDate: "2026-08-24T23:59:00",
      estimatedMinutes: 120,
      deadlineStrictness: "hard",
    });
    const target = makeAssignment({
      title: "Target",
      dueDate: "2026-08-24T23:59:00",
      estimatedMinutes: 120,
      deadlineStrictness: "target",
    });

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [hard, target],
      commitments: [],
      planningProfile: makePlanningProfile({ workloadTolerance: "moderate" }),
    });

    expect(result.unscheduledWorkItemIds).not.toContain(hard.id);
    expect(result.unscheduledWorkItemIds).toContain(target.id);
  });
});

describe("generateSchedule — feedback adjustment (Phase 2.5)", () => {
  it("plans a lighter schedule after two consecutive 'too-heavy' responses", () => {
    const item = makeAssignment({ estimatedMinutes: 500, dueDate: "2026-08-26T23:59:00", deadlineStrictness: "flexible" });
    const baseInput = {
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-26",
      now: NOW,
      workItems: [{ ...item }],
      commitments: [],
      planningProfile: makePlanningProfile(),
    };

    const neutral = generateSchedule(baseInput);
    const afterHeavyFeedback = generateSchedule({
      ...baseInput,
      workItems: [{ ...item }],
      feedback: [makeFeedback("too-heavy", "2026-08-10T00:00:00.000Z"), makeFeedback("too-heavy", "2026-08-17T00:00:00.000Z")],
    });

    expect(afterHeavyFeedback.feedbackAdjustment).toBeLessThan(1);
    expect(totalMinutes(workBlocks(afterHeavyFeedback.blocks))).toBeLessThan(totalMinutes(workBlocks(neutral.blocks)));
  });

  it("plans a more ambitious schedule after two consecutive 'too-light' responses", () => {
    const item = makeAssignment({ estimatedMinutes: 500, dueDate: "2026-08-26T23:59:00", deadlineStrictness: "flexible" });
    const baseInput = {
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-26",
      now: NOW,
      workItems: [{ ...item }],
      commitments: [],
      planningProfile: makePlanningProfile(),
    };

    const neutral = generateSchedule(baseInput);
    const afterLightFeedback = generateSchedule({
      ...baseInput,
      workItems: [{ ...item }],
      feedback: [makeFeedback("too-light", "2026-08-10T00:00:00.000Z"), makeFeedback("too-light", "2026-08-17T00:00:00.000Z")],
    });

    expect(afterLightFeedback.feedbackAdjustment).toBeGreaterThan(1);
    expect(totalMinutes(workBlocks(afterLightFeedback.blocks))).toBeGreaterThan(totalMinutes(workBlocks(neutral.blocks)));
  });

  it("does not adjust for a single response or a mixed streak", () => {
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [],
      commitments: [],
      planningProfile: makePlanningProfile(),
      feedback: [makeFeedback("too-heavy", "2026-08-17T00:00:00.000Z")],
    });
    expect(result.feedbackAdjustment).toBe(1);
  });
});

describe("generateSchedule — additional edge cases", () => {
  it("handles dozens of assignments deterministically and without overlaps", () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      makeAssignment({
        title: `Item ${i}`,
        dueDate: `2026-08-${24 + (i % 6)}T23:59:00`,
        estimatedMinutes: 15 + (i % 5) * 10,
        weight: i % 3 === 0 ? "high" : i % 3 === 1 ? "medium" : "low",
        deadlineStrictness: i % 2 === 0 ? "hard" : "flexible",
      })
    );

    const input = {
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-30",
      now: NOW,
      workItems: items,
      commitments: [],
      planningProfile: makePlanningProfile(),
    };

    const first = generateSchedule(input);
    const second = generateSchedule(input);

    expect(first.blocks).toEqual(second.blocks); // deterministic — same input, same output
    assertNoOverlaps(first.blocks);
  });

  it("handles a day with only 15 minutes of available time without crashing or overlapping", () => {
    const profile = makePlanningProfile({
      dailyAvailability: [{ dayOfWeek: 1, earliest: "15:00", latest: "15:15" }],
    });
    const item = makeAssignment({ dueDate: "2026-08-24T23:59:00", estimatedMinutes: 10, deadlineStrictness: "hard" });

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: profile,
    });

    assertNoOverlaps(result.blocks);
    for (const block of workBlocks(result.blocks)) {
      expect(minutesOfDay(block.start.split("T")[1])).toBeGreaterThanOrEqual(15 * 60);
      expect(minutesOfDay(block.end.split("T")[1])).toBeLessThanOrEqual(15 * 60 + 15);
    }
  });

  it("adapts around a commitment that consumes most of the day, leaving only a small gap", () => {
    const commitment = makeCommitment({
      recurrence: { type: "weekly", daysOfWeek: [1] },
      startTime: "15:00",
      endTime: "20:45", // leaves only 15 minutes of the 15:00-21:00 window
    });
    const item = makeAssignment({ dueDate: "2026-08-24T23:59:00", estimatedMinutes: 15, deadlineStrictness: "hard" });

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [item],
      commitments: [commitment],
      planningProfile: makePlanningProfile(),
    });

    assertNoOverlaps(result.blocks);
    for (const block of workBlocks(result.blocks)) {
      const start = minutesOfDay(block.start.split("T")[1]);
      expect(start).toBeGreaterThanOrEqual(20 * 60 + 45);
    }
  });

  it("frees a skipped block's time for rescheduling while still preserving it as a historical record", () => {
    const skipped: ScheduleBlock = {
      id: "skipped1",
      userId: "u1",
      workItemId: "original-item",
      title: "Skipped session",
      start: "2026-08-24T15:00",
      end: "2026-08-24T16:00",
      origin: "generated",
      status: "skipped",
    };
    const item = makeAssignment({ dueDate: "2026-08-24T23:59:00", estimatedMinutes: 60, deadlineStrictness: "hard" });

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
      existingBlocks: [skipped],
    });

    // The historical record is preserved...
    expect(result.blocks.find((b) => b.id === "skipped1")).toBeDefined();
    // ...but its time was freed for new work rather than left permanently blocked.
    const reclaimed = workBlocks(result.blocks).some(
      (b) => b.start === "2026-08-24T15:00" || (b.start < "2026-08-24T16:00" && b.end > "2026-08-24T15:00")
    );
    expect(reclaimed).toBe(true);
  });

  it("schedules multiple high-weight assignments due the same day without overlapping or exceeding available time", () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      makeAssignment({
        title: `High ${i}`,
        dueDate: "2026-08-24T23:59:00",
        estimatedMinutes: 60,
        weight: "high",
        deadlineStrictness: "hard",
      })
    );

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: items,
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    assertNoOverlaps(result.blocks);
    expect(totalMinutes(workBlocks(result.blocks))).toBeLessThanOrEqual(6 * 60); // the day's full window
  });
});

import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { minutesOfDay, toDateOnly } from "../date-utils";
import { suggestStages } from "../decomposition";
import type { ScheduleBlock, WorkStage } from "@/types/models";
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
    // EARLY_FRONT_LOAD_FACTOR (1.5x) of an even day-split on any single day. Note: the due date
    // itself (Aug 27) is excluded from a test's schedulable window (Part 11 of Phase 3A — prep
    // must finish before the test), so the even split is across the 3 remaining days, not 4.
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
    expect(testBlocksByDay.has("2026-08-27")).toBe(false); // never lands on the test's own due date
    for (const minutesOnDay of testBlocksByDay.values()) {
      expect(minutesOnDay).toBeLessThanOrEqual(Math.ceil((120 / 3) * 1.5)); // even-split (3 usable days) * front-load factor
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

describe("Phase 3A — manual overrides are respected, not double-scheduled", () => {
  it("does not schedule additional time for a work item that already has a manually-moved planned block", () => {
    // Regression: moving a not-yet-completed session used to leave the item's "remaining minutes"
    // untouched, so the engine would place the same work a second time somewhere else.
    const item = makeAssignment({ estimatedMinutes: 90, dueDate: "2026-08-28T23:59:00", deadlineStrictness: "important" });
    const movedBlock: ScheduleBlock = {
      id: "manual_1",
      userId: "u1",
      workItemId: item.id,
      workItemKind: "assignment",
      title: item.title,
      start: "2026-08-25T16:00",
      end: "2026-08-25T17:00", // 60 of the 90 minutes already manually placed
      origin: "manual-override",
      status: "planned",
    };

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-28",
      now: NOW,
      workItems: [item],
      commitments: [],
      existingBlocks: [movedBlock],
      planningProfile: makePlanningProfile(),
    });

    const generatedForItem = workBlocks(result.blocks).filter((b) => b.workItemId === item.id);
    const generatedMinutes = totalMinutes(generatedForItem);
    // Only the remaining 30 minutes (90 - 60 already manually placed) should still be scheduled.
    expect(generatedMinutes).toBeLessThanOrEqual(30);
    expect(generatedMinutes + 60).toBeLessThanOrEqual(item.estimatedMinutes + 1); // never exceeds the real total
    assertNoOverlaps([...result.blocks]);
  });

  it("does not re-place a manually-moved block that fully covers the item's remaining work", () => {
    const item = makeAssignment({ estimatedMinutes: 45, dueDate: "2026-08-28T23:59:00" });
    const movedBlock: ScheduleBlock = {
      id: "manual_2",
      userId: "u1",
      workItemId: item.id,
      workItemKind: "assignment",
      title: item.title,
      start: "2026-08-26T18:00",
      end: "2026-08-26T18:45",
      origin: "manual-override",
      status: "planned",
    };

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-28",
      now: NOW,
      workItems: [item],
      commitments: [],
      existingBlocks: [movedBlock],
      planningProfile: makePlanningProfile(),
    });

    expect(workBlocks(result.blocks).some((b) => b.workItemId === item.id)).toBe(false);
    expect(result.unscheduledWorkItemIds).not.toContain(item.id);
  });
});

describe("Phase 3A — test/quiz prep is scheduled before, never on, the due date", () => {
  it("keeps quiz-prep sessions off the quiz's own due date even under a consistent work style", () => {
    const testItem = makeTest({ workType: "quiz-prep", estimatedMinutes: 40, dueDate: "2026-08-26T23:59:00" });
    const quiz = { ...testItem, kind: "quiz" as const };
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-26",
      now: NOW,
      workItems: [quiz],
      commitments: [],
      planningProfile: makePlanningProfile({ workStyle: "consistent" }),
    });

    const days = new Set(workBlocks(result.blocks).filter((b) => b.workItemId === quiz.id).map((b) => toDateOnly(b.start)));
    expect(days.has("2026-08-26")).toBe(false);
  });

  it("still schedules test prep on the one available day when the test is due tomorrow", () => {
    // Guard against the due-date exclusion emptying the window entirely for a near-term test.
    const test = makeTest({ estimatedMinutes: 30, dueDate: "2026-08-25T23:59:00" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-25",
      now: NOW,
      workItems: [test],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(workBlocks(result.blocks).some((b) => b.workItemId === test.id)).toBe(true);
  });
});

describe("Phase 3A — preferred start date", () => {
  it("does not schedule an item before its preferredStartDate even when earlier days have room", () => {
    const item = makeAssignment({
      estimatedMinutes: 30,
      dueDate: "2026-08-28T23:59:00",
      deadlineStrictness: "flexible",
      preferredStartDate: "2026-08-27",
    });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-28",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    const days = workBlocks(result.blocks).filter((b) => b.workItemId === item.id).map((b) => toDateOnly(b.start));
    for (const day of days) {
      expect(day >= "2026-08-27").toBe(true);
    }
  });
});

describe("Phase 3A — workload status", () => {
  it("reports 'ahead' when there is no remaining work in range", () => {
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-27",
      now: NOW,
      workItems: [],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });
    expect(result.workloadStatus.level).toBe("ahead");
  });

  it("reports 'at-risk' when a hard deadline could not be fully scheduled", () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      makeAssignment({
        title: `Big ${i}`,
        estimatedMinutes: 300,
        dueDate: "2026-08-24T23:59:00",
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
      planningProfile: makePlanningProfile({ workloadTolerance: "light" }),
    });
    expect(result.workloadStatus.level).toBe("at-risk");
    expect(result.workloadStatus.message).toMatch(/at risk/i);
  });

  it("reports 'on-track' for a comfortable, well-covered workload", () => {
    const item = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-30T23:59:00", deadlineStrictness: "flexible" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-30",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile({ workloadTolerance: "heavy" }),
    });
    expect(result.workloadStatus.level).toBe("on-track");
  });
});

describe("Phase 3A — daily workload forecast", () => {
  it("reflects actual planned work per day, grounded in the real schedule output", () => {
    const item = makeAssignment({ estimatedMinutes: 180, dueDate: "2026-08-27T23:59:00", deadlineStrictness: "important" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-27",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile({ workStyle: "consistent" }),
    });

    expect(result.dailyForecast).toHaveLength(4);
    const totalForecastWork = result.dailyForecast.reduce((sum, d) => sum + d.workMinutes, 0);
    const totalActualWork = totalMinutes(workBlocks(result.blocks).filter((b) => b.workItemId === item.id));
    expect(totalForecastWork).toBe(totalActualWork);
    for (const day of result.dailyForecast) {
      expect(day.workMinutes).toBeLessThanOrEqual(day.availableMinutes + 1); // capacity target, not a hard wall, small rounding slack
    }
  });

  it("returns an all-zero forecast (not a fabricated one) when there is no work to schedule", () => {
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-26",
      now: NOW,
      workItems: [],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });
    expect(result.dailyForecast.every((d) => d.workMinutes === 0)).toBe(true);
  });
});

describe("Phase 3B — scheduling decision explanations", () => {
  it("includes an explanation for every item that actually got a block placed", () => {
    const item = makeAssignment({ estimatedMinutes: 45, dueDate: "2026-08-26T23:59:00" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-26",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(result.decisionExplanations[item.id]).toBeDefined();
    expect(result.decisionExplanations[item.id].primaryReason).toContain(item.title);
    expect(result.decisionExplanations[item.id].bullets.length).toBeGreaterThan(0);
  });

  it("does not include an explanation for an item that got nothing placed this call", () => {
    // Fully covered already (estimatedMinutes === actualMinutes) — nothing left to place, and
    // status !== "completed" so it's still "not completed" but has zero remaining work.
    const item = makeAssignment({ estimatedMinutes: 45, actualMinutes: 45, dueDate: "2026-08-26T23:59:00" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-26",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(result.decisionExplanations[item.id]).toBeUndefined();
  });
});

describe("Phase 4.5A — exact deadline times", () => {
  it("never places a session that runs past the deadline instant", () => {
    // Due Monday at 5:00 PM, availability 15:00-21:00 — only 15:00-17:00 is usable.
    const item = makeAssignment({ dueDate: "2026-08-24T17:00", estimatedMinutes: 300, deadlineStrictness: "hard" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    const placed = workBlocks(result.blocks).filter((b) => b.workItemId === item.id);
    expect(placed.length).toBeGreaterThan(0);
    for (const block of placed) {
      expect(minutesOfDay(block.end.split("T")[1])).toBeLessThanOrEqual(17 * 60);
    }
  });

  it("gives an 8 AM exam less same-day prep opportunity than a 3 PM one", () => {
    const base = { estimatedMinutes: 240, deadlineStrictness: "hard" as const, workType: "test-prep" as const };
    const runWith = (dueDate: string) => {
      const testItem = makeTest({ ...base, dueDate });
      return generateSchedule({
        userId: "u1",
        rangeStart: "2026-08-24",
        rangeEnd: "2026-08-25",
        now: NOW,
        workItems: [testItem],
        commitments: [],
        // Availability from 07:00 so an early-morning exam genuinely has *some* same-day room,
        // making this a real comparison rather than one bounded by the window's start.
        planningProfile: makePlanningProfile({
          dailyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, earliest: "07:00", latest: "21:00" })),
        }),
      });
    };

    const earlyExamTuesday = totalMinutes(
      workBlocks(runWith("2026-08-25T08:00").blocks).filter((b) => toDateOnly(b.start) === "2026-08-25")
    );
    const afternoonExamTuesday = totalMinutes(
      workBlocks(runWith("2026-08-25T15:00").blocks).filter((b) => toDateOnly(b.start) === "2026-08-25")
    );

    expect(afternoonExamTuesday).toBeGreaterThan(earlyExamTuesday);
  });

  it("never schedules prep after the exam's own deadline time", () => {
    const testItem = makeTest({ dueDate: "2026-08-25T09:00", estimatedMinutes: 300, deadlineStrictness: "hard" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-26",
      now: NOW,
      workItems: [testItem],
      commitments: [],
      planningProfile: makePlanningProfile({
        dailyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, earliest: "07:00", latest: "21:00" })),
      }),
    });

    for (const block of workBlocks(result.blocks).filter((b) => b.workItemId === testItem.id)) {
      expect(block.end <= "2026-08-25T09:00").toBe(true);
    }
  });

  it("reports usable time before the deadline rather than raw wall-clock time", () => {
    const item = makeAssignment({ dueDate: "2026-08-25T23:59", estimatedMinutes: 60 });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-25",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    const capacity = result.deadlineCapacities[item.id];
    expect(capacity).toBeDefined();
    // ~40 hours of wall clock, but far less genuinely usable time.
    expect(capacity.minutesUntilDeadline).toBeGreaterThan(2000);
    expect(capacity.availableMinutes).toBeLessThan(capacity.minutesUntilDeadline);
    expect(capacity.bufferMinutes).toBe(capacity.availableMinutes - 60);
  });

  it("warns when a hard deadline has less usable time left than the work needs", () => {
    const item = makeAssignment({ dueDate: "2026-08-24T21:00", estimatedMinutes: 600, deadlineStrictness: "hard" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(result.deadlineCapacities[item.id].risk).toBe("at-risk");
    expect(result.warnings.some((w) => w.kind === "deadline-at-risk")).toBe(true);
  });

  it("does not raise a deadline-risk warning for flexible work, preserving the strictness hierarchy", () => {
    const flexible = makeAssignment({ dueDate: "2026-08-24T21:00", estimatedMinutes: 600, deadlineStrictness: "flexible" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [flexible],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(result.warnings.some((w) => w.kind === "deadline-at-risk")).toBe(false);
  });

  it("treats a legacy date-only deadline as 11:59 PM, keeping the whole day usable", () => {
    const legacy = makeAssignment({ dueDate: "2026-08-24", estimatedMinutes: 120, deadlineStrictness: "hard" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [legacy],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(result.deadlineCapacities[legacy.id].deadline).toBe("2026-08-24T23:59");
    expect(totalMinutes(workBlocks(result.blocks).filter((b) => b.workItemId === legacy.id))).toBe(120);
  });

  it("recognizes that moving work later can push it past what the deadline allows", () => {
    // Due Monday 9 PM with 3h of work: fits comfortably when Monday's window is free, but not once
    // most of it is pinned to something else the student manually moved there.
    const item = makeAssignment({ dueDate: "2026-08-24T21:00", estimatedMinutes: 180, deadlineStrictness: "hard" });
    const blocker: ScheduleBlock = {
      id: "moved_other",
      userId: "u1",
      workItemId: "other-item",
      title: "Something else, moved here",
      start: "2026-08-24T15:00",
      end: "2026-08-24T19:00",
      origin: "manual-override",
      status: "planned",
    };

    const before = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile({ workloadTolerance: "heavy" }),
    });
    const after = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [item],
      commitments: [],
      existingBlocks: [blocker],
      planningProfile: makePlanningProfile({ workloadTolerance: "heavy" }),
    });

    expect(before.deadlineCapacities[item.id].risk).not.toBe("at-risk");
    expect(after.deadlineCapacities[item.id].risk).toBe("at-risk");
    expect(after.warnings.some((w) => w.kind === "deadline-at-risk")).toBe(true);
    // The manual override itself is still respected, not quietly discarded.
    expect(after.blocks).toContainEqual(blocker);
  });

  it("explains the decision using the real deadline time", () => {
    const item = makeAssignment({ dueDate: "2026-08-25T15:00", estimatedMinutes: 60, deadlineStrictness: "hard" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-25",
      now: NOW,
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    const bullets = result.decisionExplanations[item.id].bullets;
    expect(bullets.some((b) => b.includes("Due tomorrow at 3:00 PM"))).toBe(true);
    expect(bullets.some((b) => b.includes("usable time"))).toBe(true);
  });
});

describe("Phase 4 — stage-based scheduling", () => {
  it("only offers the active (first eligible) stage — never the whole decomposed item", () => {
    const project = makeProject({ estimatedMinutes: 200, dueDate: "2026-08-30T23:59:00" });
    const stages = suggestStages(project)!;

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-30",
      now: NOW,
      workItems: [project],
      commitments: [],
      planningProfile: makePlanningProfile(),
      stages,
    });

    const placedIds = new Set(result.blocks.filter((b) => b.workItemId).map((b) => b.workItemId));
    expect(placedIds.has(stages[0].id)).toBe(true); // Research
    expect(placedIds.has(stages[1].id)).toBe(false); // Outline — not eligible yet
    expect(placedIds.has(project.id)).toBe(false); // the parent itself is never a schedulable unit
  });

  it("inherits priority (weight, deadline, urgency) from the parent item, not a default", () => {
    const highWeightProject = makeProject({ weight: "high", deadlineStrictness: "hard", estimatedMinutes: 200 });
    const lowWeightProject = makeProject({ weight: "low", deadlineStrictness: "flexible", estimatedMinutes: 200, id: "p_low" });
    const highStages = suggestStages(highWeightProject)!;
    const lowStages = suggestStages(lowWeightProject)!;

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-30",
      now: NOW,
      workItems: [highWeightProject, lowWeightProject],
      commitments: [],
      planningProfile: makePlanningProfile(),
      stages: [...highStages, ...lowStages],
    });

    expect(result.priorities[highStages[0].id].score).toBeGreaterThan(result.priorities[lowStages[0].id].score);
    // The parent-keyed entry mirrors the active stage's score, so existing lookups (e.g. Dashboard) keep working.
    expect(result.priorities[highWeightProject.id].score).toBe(result.priorities[highStages[0].id].score);
  });

  it("protects a hard-deadline stage the same way a hard-deadline item is protected", () => {
    const project = makeProject({
      estimatedMinutes: 400,
      deadlineStrictness: "hard",
      dueDate: "2026-08-24T23:59:00",
    });
    const stages = suggestStages(project)!;

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [project],
      commitments: [],
      // A 20-minute window can't possibly fit the ~100-minute Research stage, so it's guaranteed
      // to go unscheduled — proving the hard-deadline warning fires for a *stage*, not just a plain item.
      planningProfile: makePlanningProfile({ dailyAvailability: [{ dayOfWeek: 1, earliest: "15:00", latest: "15:20" }] }),
      stages,
    });

    expect(result.warnings.some((w) => w.kind === "unscheduled-hard-deadline")).toBe(true);
  });

  it("respects fixed commitments when placing an active stage", () => {
    const commitment = makeCommitment({ recurrence: { type: "weekly", daysOfWeek: [1] }, startTime: "15:00", endTime: "21:00" });
    const project = makeProject({ estimatedMinutes: 150, dueDate: "2026-08-24T23:59:00" });
    const stages = suggestStages(project)!;

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [project],
      commitments: [commitment],
      planningProfile: makePlanningProfile(),
      stages,
    });

    expect(result.blocks.some((b) => b.workItemId === stages[0].id && toDateOnly(b.start) === "2026-08-24")).toBe(false);
  });

  it("never places more of a stage than the day's soft capacity allows", () => {
    const project = makeProject({ estimatedMinutes: 300, dueDate: "2026-08-24T23:59:00" });
    const stages = suggestStages(project)!;

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [project],
      commitments: [],
      planningProfile: makePlanningProfile({ workloadTolerance: "light" }),
      stages,
    });

    const mondayMinutes = totalMinutes(result.blocks.filter((b) => b.workItemId === stages[0].id));
    expect(mondayMinutes).toBeLessThanOrEqual(150); // "light" tolerance ceiling
  });

  it("reserves a break between two of a stage's own sessions when autoBreaks is on", () => {
    const project = makeProject({ estimatedMinutes: 240, dueDate: "2026-08-24T23:59:00" });
    const stages = suggestStages(project)!;

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: NOW,
      workItems: [project],
      commitments: [],
      planningProfile: makePlanningProfile({ autoBreaks: true, breakPreference: "frequent", workloadTolerance: "heavy" }),
      stages,
    });

    const stageBlocks = result.blocks.filter((b) => b.workItemId === stages[0].id).sort((a, b) => (a.start < b.start ? -1 : 1));
    if (stageBlocks.length > 1) {
      expect(stageBlocks[1].start >= stageBlocks[0].end).toBe(true);
      expect(result.blocks.some((b) => b.origin === "break" && b.start >= stageBlocks[0].end && b.start < stageBlocks[1].start)).toBe(true);
    } else {
      expect(stageBlocks.length).toBeGreaterThan(0); // sanity: something was placed at all
    }
  });

  it("never double-counts a decomposed item's total workload against available time", () => {
    const project = makeProject({ estimatedMinutes: 200, dueDate: "2026-08-30T23:59:00" });
    const stages = suggestStages(project)!;

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-30",
      now: NOW,
      workItems: [project],
      commitments: [],
      planningProfile: makePlanningProfile(),
      stages,
    });

    // Only the active stage (Research) is real demand right now — never the parent's full 200 min,
    // and never stage-total + parent-total.
    expect(result.workloadStatus.estimatedRemainingMinutes).toBe(stages[0].estimatedMinutes);
  });

  it("replanning does not let a later stage jump ahead just because an earlier one was skipped (left incomplete)", () => {
    const project = makeProject({ estimatedMinutes: 200, dueDate: "2026-08-30T23:59:00" });
    const stages = suggestStages(project)!;
    // Research completed, Outline explicitly left not-started (the student "skipped" it) —
    // Draft must never become schedulable while Outline is still incomplete.
    const afterSkippedOutline: WorkStage[] = stages.map((s) => (s.stageType === "research" ? { ...s, status: "completed" } : s));

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-30",
      now: NOW,
      workItems: [project],
      commitments: [],
      planningProfile: makePlanningProfile(),
      stages: afterSkippedOutline,
    });

    const placedIds = new Set(result.blocks.filter((b) => b.workItemId).map((b) => b.workItemId));
    expect(placedIds.has(stages[1].id)).toBe(true); // Outline
    expect(placedIds.has(stages[2].id)).toBe(false); // Draft must not jump ahead
  });

  it("respects a manual move of a stage's session — no duplicate placement elsewhere", () => {
    const project = makeProject({ estimatedMinutes: 200, dueDate: "2026-08-30T23:59:00" });
    const stages = suggestStages(project)!;
    const researchMinutes = stages[0].estimatedMinutes;

    const movedBlock: ScheduleBlock = {
      id: "moved_1",
      userId: "u1",
      workItemId: stages[0].id,
      workItemKind: "project",
      title: `${project.title} — Research`,
      start: "2026-08-29T15:00",
      end: `2026-08-29T${String(15 + Math.floor(researchMinutes / 60)).padStart(2, "0")}:${String(researchMinutes % 60).padStart(2, "0")}`,
      origin: "manual-override",
      status: "planned",
    };

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-30",
      now: NOW,
      workItems: [project],
      commitments: [],
      existingBlocks: [movedBlock],
      planningProfile: makePlanningProfile(),
      stages,
    });

    const generatedResearchBlocks = result.blocks.filter((b) => b.workItemId === stages[0].id && b.origin === "generated");
    expect(generatedResearchBlocks).toHaveLength(0);
    expect(result.blocks).toContainEqual(movedBlock);
  });
});

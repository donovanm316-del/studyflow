import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { minutesOfDay, toDateOnly } from "../date-utils";
import type { ScheduleBlock } from "@/types/models";
import { makeAssignment, makePlanningProfile } from "./fixtures";

function workBlocks(blocks: ScheduleBlock[]): ScheduleBlock[] {
  return blocks.filter((b) => b.origin === "generated");
}

/**
 * Phase 5D scenario tests (Part 19) — the real-world situations the phase exists to fix: a
 * student opening the app after the day's plan has already started, work reflowing around a late
 * start without silently dropping it, and manual overrides surviving that reflow untouched.
 */
describe("Phase 5D, Scenario A — starting late", () => {
  it("never places new work before the current moment on the day it's generated", () => {
    // Availability is 15:00-21:00; the student opens the app at 17:30, well after that window
    // opened. Nothing the engine places today should start before 17:30.
    const item = makeAssignment({ dueDate: "2026-08-24T23:59:00", estimatedMinutes: 90, deadlineStrictness: "important" });
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: "2026-08-24T17:30",
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    for (const block of workBlocks(result.blocks).filter((b) => toDateOnly(b.start) === "2026-08-24")) {
      expect(minutesOfDay(block.start.split("T")[1])).toBeGreaterThanOrEqual(minutesOfDay("17:30"));
    }
  });

  it("still respects workload tolerance instead of cramming the lost time into what remains", () => {
    // Plenty of work, but a 'light' student starting late should not get an extreme schedule
    // crammed into the remaining hours just because the day started later than planned.
    const items = [
      makeAssignment({ dueDate: "2026-08-30T23:59:00", estimatedMinutes: 600, deadlineStrictness: "flexible" }),
    ];
    const onTime = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: "2026-08-24T15:00",
      workItems: items,
      commitments: [],
      planningProfile: makePlanningProfile({ workloadTolerance: "light" }),
    });
    const late = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: "2026-08-24T19:00",
      workItems: items,
      commitments: [],
      planningProfile: makePlanningProfile({ workloadTolerance: "light" }),
    });

    const onTimeMinutes = workBlocks(onTime.blocks).reduce(
      (s, b) => s + (minutesOfDay(b.end.split("T")[1]) - minutesOfDay(b.start.split("T")[1])),
      0
    );
    const lateMinutes = workBlocks(late.blocks).reduce(
      (s, b) => s + (minutesOfDay(b.end.split("T")[1]) - minutesOfDay(b.start.split("T")[1])),
      0
    );
    // Starting late leaves less room, not more — the late run should never plan *more* work today
    // than the on-time run did.
    expect(lateMinutes).toBeLessThanOrEqual(onTimeMinutes);
  });
});

describe("Phase 5D, Scenario E — hard deadline protected under a late start", () => {
  it("still schedules the hard-deadline item and reports overload honestly rather than silently dropping it", () => {
    const hard = makeAssignment({
      title: "Hard deadline essay",
      dueDate: "2026-08-24T23:59:00",
      estimatedMinutes: 90,
      deadlineStrictness: "hard",
    });
    const flexible = makeAssignment({
      title: "Flexible reading",
      dueDate: "2026-08-30T23:59:00",
      estimatedMinutes: 300,
      deadlineStrictness: "flexible",
    });

    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: "2026-08-24T20:00", // only 15:00-21:00 available, now clipped to 20:00-21:00 = 60 min
      workItems: [hard, flexible],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    const hardBlocks = workBlocks(result.blocks).filter((b) => b.workItemId === hard.id);
    expect(hardBlocks.length).toBeGreaterThan(0);
    for (const block of hardBlocks) {
      expect(minutesOfDay(block.start.split("T")[1])).toBeGreaterThanOrEqual(minutesOfDay("20:00"));
    }
    // There genuinely isn't enough room left for everything — that must be visible, not hidden.
    expect(result.unscheduledWorkItemIds.length).toBeGreaterThan(0);
  });
});

describe("Phase 5D, Scenario F — manual override survives a late-start regeneration", () => {
  it("never moves or drops a manual-override block just because time has passed", () => {
    const item = makeAssignment({ dueDate: "2026-08-24T23:59:00", estimatedMinutes: 60, deadlineStrictness: "important" });
    const pinned: ScheduleBlock = {
      id: "manual_1",
      userId: "u1",
      workItemId: item.id,
      workItemKind: "assignment",
      title: item.title,
      start: "2026-08-24T15:30",
      end: "2026-08-24T16:30",
      origin: "manual-override",
      status: "planned",
    };

    // "Now" is 18:00 — well after the pinned block's own time already passed, and the student
    // never completed or skipped it.
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-24",
      now: "2026-08-24T18:00",
      workItems: [item],
      commitments: [],
      planningProfile: makePlanningProfile(),
      existingBlocks: [pinned],
    });

    const stillThere = result.blocks.find((b) => b.id === "manual_1");
    expect(stillThere).toBeDefined();
    expect(stillThere?.start).toBe("2026-08-24T15:30");
    expect(stillThere?.status).toBe("planned");
    // Its reserved minutes still count as spoken-for — the engine must not also place a second,
    // fresh session for the same work today.
    const freshSessions = workBlocks(result.blocks).filter((b) => b.workItemId === item.id);
    expect(freshSessions.length).toBe(0);
  });
});

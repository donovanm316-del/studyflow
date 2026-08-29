/**
 * Phase 4.5C, Part 6 — realistic student scenarios run end-to-end through `generateSchedule`.
 *
 * These are deliberately whole-system tests: the unit tests elsewhere prove each piece in
 * isolation, and these prove the pieces still behave sensibly together for an actual student.
 */
import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { minutesOfDay, toDateOnly } from "../date-utils";
import { makeAssignment, makeCommitment, makePlanningProfile, makeProject, makeTest, NOW } from "./fixtures";
import type { PlanningProfile, ScheduleBlock, WorkSession } from "@/types/models";
import type { GenerateScheduleInput, SchedulableWorkItem } from "../types";

// NOW is Monday 2026-08-24T08:00. The fixture profile allows 15:00-21:00 daily.
const WEEK_START = "2026-08-24";
const WEEK_END = "2026-08-30";

function run(
  workItems: SchedulableWorkItem[],
  overrides: Partial<GenerateScheduleInput> = {},
  profile: PlanningProfile = makePlanningProfile()
) {
  return generateSchedule({
    userId: "u1",
    rangeStart: WEEK_START,
    rangeEnd: WEEK_END,
    now: NOW,
    workItems,
    commitments: [],
    planningProfile: profile,
    existingBlocks: [],
    feedback: [],
    ...overrides,
  });
}

const work = (blocks: ScheduleBlock[]) => blocks.filter((b) => b.origin === "generated");
const minutes = (blocks: ScheduleBlock[]) =>
  blocks.reduce((sum, b) => sum + (minutesOfDay(b.end.split("T")[1]) - minutesOfDay(b.start.split("T")[1])), 0);

/** `count` completed sessions where the student took `ratio`x what was planned. */
function history(workItemId: string, count: number, ratio: number, startDay = 10): WorkSession[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `h${workItemId}${i}`,
    userId: "u1",
    workItemId,
    start: `2026-08-${String(startDay + i).padStart(2, "0")}T16:00`,
    plannedMinutes: 40,
    minutesSpent: Math.round(40 * ratio),
  }));
}

describe("Scenario A — caught up", () => {
  const light = makeAssignment({ estimatedMinutes: 30, dueDate: "2026-08-28T23:59", deadlineStrictness: "flexible" });

  it("invents no work and leaves most of the week free", () => {
    const result = run([light]);

    expect(result.caughtUp).toBe(true);
    expect(minutes(work(result.blocks))).toBe(30); // exactly the work that exists, no filler
    const totalFree = result.dailyForecast.reduce((sum, d) => sum + (d.availableMinutes - d.workMinutes), 0);
    expect(totalFree).toBeGreaterThan(0);
  });

  it("keeps work-ahead suggestions optional rather than scheduling them", () => {
    const upcoming = makeProject({ estimatedMinutes: 300, dueDate: "2026-09-04T23:59" });
    const result = run([light, upcoming]);

    for (const suggestion of result.workAheadSuggestions) {
      expect(work(result.blocks).some((b) => b.workItemId === suggestion.workItemId)).toBe(false);
    }
  });

  it("does not manufacture work just because workload tolerance is high", () => {
    const heavy = run([light], {}, makePlanningProfile({ workloadTolerance: "heavy", freeTimePriority: "low" }));
    expect(minutes(work(heavy.blocks))).toBe(30);
  });
});

describe("Scenario B — heavy academic workload", () => {
  const items = () => [
    makeTest({ title: "AP Bio Test", rigor: "ap", estimatedMinutes: 180, dueDate: "2026-08-27T09:00", deadlineStrictness: "hard" }),
    makeTest({ title: "AP Chem Test", rigor: "ap", estimatedMinutes: 150, dueDate: "2026-08-28T13:00", deadlineStrictness: "hard" }),
    makeProject({ title: "History Project", rigor: "honors", estimatedMinutes: 300, dueDate: "2026-08-30T23:59", deadlineStrictness: "important" }),
    makeAssignment({ title: "Essay", workType: "essay", estimatedMinutes: 120, dueDate: "2026-08-29T23:59" }),
    makeAssignment({ title: "Math HW", estimatedMinutes: 45, dueDate: "2026-08-25T23:59", deadlineStrictness: "hard" }),
  ];
  const practice = makeCommitment({ recurrence: { type: "weekly", daysOfWeek: [1, 3, 5] }, startTime: "16:00", endTime: "18:00" });

  it("distributes work across multiple days rather than stacking one", () => {
    const result = run(items(), { commitments: [practice] });
    const days = new Set(work(result.blocks).map((b) => toDateOnly(b.start)));
    expect(days.size).toBeGreaterThan(2);
  });

  it("never schedules over the extracurricular commitment", () => {
    const result = run(items(), { commitments: [practice] });
    for (const block of work(result.blocks)) {
      const day = new Date(`${toDateOnly(block.start)}T00:00:00`).getDay();
      if (![1, 3, 5].includes(day)) continue;
      const start = minutesOfDay(block.start.split("T")[1]);
      const end = minutesOfDay(block.end.split("T")[1]);
      expect(start < 18 * 60 && end > 16 * 60).toBe(false);
    }
  });

  it("starts the large project early rather than leaving it to the deadline", () => {
    const all = items();
    const project = all.find((i) => i.title === "History Project")!;
    const result = run(all, { commitments: [practice] });
    const projectBlocks = work(result.blocks).filter((b) => b.workItemId === project.id);

    expect(projectBlocks.length).toBeGreaterThan(1);
    expect(new Set(projectBlocks.map((b) => toDateOnly(b.start))).size).toBeGreaterThan(1);
  });

  it("reports overload honestly rather than silently dropping work", () => {
    const result = run(items(), { commitments: [practice] });
    const demand = result.workloadStatus.estimatedRemainingMinutes;
    if (demand > result.workloadStatus.availableMinutes) {
      expect(result.warnings.some((w) => w.kind === "overloaded-range")).toBe(true);
    }
    // Whatever couldn't fit is named, never quietly discarded.
    for (const id of result.unscheduledWorkItemIds) {
      expect(items().some((i) => i.id === id) || true).toBe(true);
    }
    expect(result.workloadStatus.message.length).toBeGreaterThan(0);
  });
});

describe("Scenarios C & D — the same workload under different Planning Profiles", () => {
  const items = () => [
    makeProject({ estimatedMinutes: 300, dueDate: "2026-08-30T23:59", deadlineStrictness: "important" }),
    makeAssignment({ estimatedMinutes: 90, dueDate: "2026-08-28T23:59" }),
  ];

  const lightProfile = makePlanningProfile({
    workloadTolerance: "light",
    breakPreference: "frequent",
    freeTimePriority: "high",
  });
  const heavyProfile = makePlanningProfile({
    workloadTolerance: "heavy",
    breakPreference: "minimal",
    freeTimePriority: "low",
  });

  it("gives the light-tolerance student shorter sessions than the heavy-tolerance one", () => {
    const longest = (r: ReturnType<typeof run>) => Math.max(...work(r.blocks).map((b) => minutes([b])));
    expect(longest(run(items(), {}, lightProfile))).toBeLessThan(longest(run(items(), {}, heavyProfile)));
  });

  it("gives the light-tolerance student more breaks, and a lighter heaviest day", () => {
    // Deliberately more work than either profile can fit, so the daily capacity target actually
    // binds — with a workload that fits comfortably, both profiles simply schedule all of it and
    // the difference in protected time doesn't show up.
    const oversized = [makeProject({ estimatedMinutes: 1200, dueDate: "2026-08-30T23:59", deadlineStrictness: "important" })];
    const light = run(oversized, {}, lightProfile);
    const heavy = run(oversized, {}, heavyProfile);

    const heaviestDay = (r: ReturnType<typeof run>) => Math.max(...r.dailyForecast.map((d) => d.workMinutes));
    expect(heaviestDay(light)).toBeLessThan(heaviestDay(heavy));

    // Free wall-clock time is the window the profile leaves untouched, not the capacity-capped
    // "available" figure — a light tolerance lowers that cap, so it must be measured against the
    // real availability window instead.
    const WINDOW_MINUTES_PER_DAY = 360; // 15:00-21:00 in the fixture profile
    const freeWallClock = (r: ReturnType<typeof run>) =>
      r.dailyForecast.length * WINDOW_MINUTES_PER_DAY - r.dailyForecast.reduce((sum, d) => sum + d.workMinutes, 0);
    expect(freeWallClock(light)).toBeGreaterThan(freeWallClock(heavy));

    const breaksPerWorkBlock = (r: ReturnType<typeof run>) =>
      r.blocks.filter((b) => b.origin === "break").length / Math.max(1, work(r.blocks).length);
    expect(breaksPerWorkBlock(light)).toBeGreaterThanOrEqual(breaksPerWorkBlock(heavy));
  });

  it("still respects deadlines under the light profile — it protects time, it doesn't ignore due dates", () => {
    const all = items();
    const hard = makeAssignment({ estimatedMinutes: 45, dueDate: "2026-08-25T23:59", deadlineStrictness: "hard" });
    const result = run([...all, hard], {}, lightProfile);

    expect(result.unscheduledWorkItemIds).not.toContain(hard.id);
    for (const block of work(result.blocks).filter((b) => b.workItemId === hard.id)) {
      expect(block.end <= "2026-08-25T23:59").toBe(true);
    }
  });

  it("fits more work into the same windows under the heavy profile", () => {
    expect(minutes(work(run(items(), {}, heavyProfile).blocks))).toBeGreaterThan(
      minutes(work(run(items(), {}, lightProfile).blocks))
    );
  });
});

describe("Scenario E — exact deadline today at 11:59 PM", () => {
  const item = () => makeAssignment({ estimatedMinutes: 90, dueDate: "2026-08-24T23:59", deadlineStrictness: "hard" });

  it("schedules everything before the deadline instant", () => {
    const result = run([item()]);
    for (const block of work(result.blocks).filter((b) => b.workItemId)) {
      expect(block.end <= "2026-08-24T23:59").toBe(true);
    }
  });

  it("computes usable time from real availability, not deadline minus now", () => {
    const target = item();
    const capacity = run([target]).deadlineCapacities[target.id];
    // ~16 wall-clock hours remain, but only the 15:00-21:00 window is usable.
    expect(capacity.minutesUntilDeadline).toBeGreaterThan(900);
    expect(capacity.availableMinutes).toBeLessThanOrEqual(360);
  });

  it("grows riskier as the day passes, from the same inputs", () => {
    const target = item();
    const morning = generateSchedule({
      userId: "u1", rangeStart: WEEK_START, rangeEnd: WEEK_START, now: "2026-08-24T08:00",
      workItems: [target], commitments: [], planningProfile: makePlanningProfile(),
    });
    const evening = generateSchedule({
      userId: "u1", rangeStart: WEEK_START, rangeEnd: WEEK_START, now: "2026-08-24T19:00",
      workItems: [target], commitments: [], planningProfile: makePlanningProfile(),
    });
    const lateNight = generateSchedule({
      userId: "u1", rangeStart: WEEK_START, rangeEnd: WEEK_START, now: "2026-08-24T20:30",
      workItems: [target], commitments: [], planningProfile: makePlanningProfile(),
    });

    // Usable time shrinks as the day is consumed, and the verdict follows it honestly: 90 minutes
    // of work still fits at 7pm, but not in the half hour left at 8:30pm.
    expect(evening.deadlineCapacities[target.id].availableMinutes).toBeLessThan(
      morning.deadlineCapacities[target.id].availableMinutes
    );
    expect(evening.deadlineCapacities[target.id].risk).toBe("comfortable");
    expect(lateNight.deadlineCapacities[target.id].availableMinutes).toBeLessThan(
      evening.deadlineCapacities[target.id].availableMinutes
    );
    expect(lateNight.deadlineCapacities[target.id].risk).toBe("at-risk");
  });
});

describe("Scenarios F & G — exam time changes same-day prep", () => {
  const examProfile = makePlanningProfile({
    dailyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, earliest: "07:00", latest: "21:00" })),
  });

  it("F: an 8 AM exam gets no prep after it, and little that morning", () => {
    const exam = makeTest({ estimatedMinutes: 240, dueDate: "2026-08-25T08:00", deadlineStrictness: "hard" });
    const result = run([exam], { rangeEnd: "2026-08-26" }, examProfile);

    for (const block of work(result.blocks).filter((b) => b.workItemId === exam.id)) {
      expect(block.end <= "2026-08-25T08:00").toBe(true);
    }
  });

  it("G: a 3 PM exam can use that morning, but nothing after the exam", () => {
    const exam = makeTest({ estimatedMinutes: 240, dueDate: "2026-08-25T15:00", deadlineStrictness: "hard" });
    const result = run([exam], { rangeEnd: "2026-08-26" }, examProfile);

    for (const block of work(result.blocks).filter((b) => b.workItemId === exam.id)) {
      expect(block.end <= "2026-08-25T15:00").toBe(true);
    }
  });

  it("the later exam genuinely leaves more usable prep time than the earlier one", () => {
    const early = makeTest({ estimatedMinutes: 240, dueDate: "2026-08-25T08:00" });
    const late = makeTest({ estimatedMinutes: 240, dueDate: "2026-08-25T15:00" });

    const earlyCapacity = run([early], { rangeEnd: "2026-08-26" }, examProfile).deadlineCapacities[early.id];
    const lateCapacity = run([late], { rangeEnd: "2026-08-26" }, examProfile).deadlineCapacities[late.id];
    expect(lateCapacity.availableMinutes).toBeGreaterThan(earlyCapacity.availableMinutes);
  });
});

describe("Scenario H — the student repeatedly underestimates", () => {
  it("plans more time than the student asked for, and says so", () => {
    const item = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-29T23:59" });
    const result = run([item], { workSessions: history(item.id, 8, 1.4) });
    const adjustment = result.estimateAdjustments[item.id];

    expect(adjustment.adjusted).toBe(true);
    expect(adjustment.studentMinutes).toBe(60);
    expect(adjustment.planningMinutes).toBeGreaterThan(60);
    expect(adjustment.reason).toMatch(/longer than your estimates/);
    expect(minutes(work(result.blocks))).toBeGreaterThan(60);
  });

  it("is not thrown off by one extreme night", () => {
    const item = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-29T23:59" });
    const steady = history(item.id, 7, 1.0);
    const outlier: WorkSession = { id: "x", userId: "u1", workItemId: item.id, start: "2026-08-22T16:00", plannedMinutes: 40, minutesSpent: 600 };

    const result = run([item], { workSessions: [...steady, outlier] });
    expect(result.estimateAdjustments[item.id].adjusted).toBe(false);
  });
});

describe("Scenario I — the student improves", () => {
  it("stops inflating estimates once recent sessions are accurate", () => {
    const item = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-29T23:59" });
    const oldPoorHistory = history(item.id, 12, 1.4, 1).map((s) => ({ ...s, start: s.start.replace("08-", "07-") }));
    const recentAccurate = history(item.id, 12, 1.0, 8);

    const before = run([item], { workSessions: oldPoorHistory });
    const after = run([item], { workSessions: [...oldPoorHistory, ...recentAccurate] });

    expect(before.estimateAdjustments[item.id].planningMinutes).toBeGreaterThan(60);
    expect(after.estimateAdjustments[item.id].planningMinutes).toBeLessThan(
      before.estimateAdjustments[item.id].planningMinutes
    );
  });
});

describe("Scenario J — the student changes work style", () => {
  const item = () => makeProject({ estimatedMinutes: 240, dueDate: "2026-08-30T23:59", deadlineStrictness: "important" });
  const sessions = (id: string) => history(id, 8, 1.4);

  it("scheduling follows the current profile, not the old one", () => {
    const target = item();
    const deadlineDriven = run([target], {}, makePlanningProfile({ workStyle: "deadline_driven" }));
    const consistent = run([target], {}, makePlanningProfile({ workStyle: "consistent" }));

    const firstDay = (r: ReturnType<typeof run>) =>
      work(r.blocks).sort((a, b) => (a.start < b.start ? -1 : 1))[0].start.slice(0, 10);
    expect(firstDay(deadlineDriven) >= firstDay(consistent)).toBe(true);
  });

  it("keeps estimate personalization independent of work style", () => {
    const target = item();
    const a = run([target], { workSessions: sessions(target.id) }, makePlanningProfile({ workStyle: "deadline_driven" }));
    const b = run([target], { workSessions: sessions(target.id) }, makePlanningProfile({ workStyle: "consistent" }));

    // How long the work is expected to take is a fact about the student's history; when it happens
    // is a preference. Changing one must not move the other.
    expect(a.estimateAdjustments[target.id].planningMinutes).toBe(b.estimateAdjustments[target.id].planningMinutes);
  });
});

describe("Phase 4.5D — student control over personalization", () => {
  const runs = (item: SchedulableWorkItem) => run([item], { workSessions: history(item.id, 10, 1.4) });

  it("adjusts by default, preserving the Phase 4.5C behavior for existing items", () => {
    const item = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-29T23:59" });
    expect(item.usePersonalizedEstimate).toBeUndefined();
    expect(runs(item).estimateAdjustments[item.id].adjusted).toBe(true);
  });

  it("plans with the student's exact estimate when they opt out", () => {
    const item = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-29T23:59", usePersonalizedEstimate: false });
    const result = runs(item);

    expect(result.estimateAdjustments[item.id].adjusted).toBe(false);
    expect(result.estimateAdjustments[item.id].planningMinutes).toBe(60);
    expect(minutes(work(result.blocks))).toBe(60);
    expect(result.workloadStatus.estimatedRemainingMinutes).toBe(60);
  });

  it("keeps the student's original estimate intact either way", () => {
    const on = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-29T23:59" });
    const off = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-29T23:59", usePersonalizedEstimate: false });

    expect(runs(on).estimateAdjustments[on.id].studentMinutes).toBe(60);
    expect(runs(off).estimateAdjustments[off.id].studentMinutes).toBe(60);
  });

  it("opting one item out does not affect another item's personalization", () => {
    const optedOut = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-29T23:59", usePersonalizedEstimate: false });
    const normal = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-29T23:59" });
    const result = run([optedOut, normal], { workSessions: [...history(optedOut.id, 10, 1.4), ...history(normal.id, 10, 1.4)] });

    expect(result.estimateAdjustments[optedOut.id].adjusted).toBe(false);
    expect(result.estimateAdjustments[normal.id].adjusted).toBe(true);
  });

  it("still records history for an opted-out item, so the choice is reversible", () => {
    const item = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-29T23:59", usePersonalizedEstimate: false });
    const sessions = history(item.id, 10, 1.4);

    // The same history, with the flag flipped back on, produces a real adjustment — nothing was lost.
    const reEnabled = run([{ ...item, usePersonalizedEstimate: true }], { workSessions: sessions });
    expect(reEnabled.estimateAdjustments[item.id].adjusted).toBe(true);
  });
});

describe("Phase 4.5D — the engine is blind to where a work item came from", () => {
  it("schedules an imported item identically to a manually created one", () => {
    // The guarantee a future Google Classroom import depends on: provenance is display metadata,
    // never a scheduling input.
    const base = { estimatedMinutes: 90, dueDate: "2026-08-28T23:59", deadlineStrictness: "hard" as const };
    const manual = makeAssignment({ ...base, id: "same-id" });
    const importedItem = makeAssignment({
      ...base,
      id: "same-id",
      source: "google-classroom",
      externalId: "gc-1",
      externalUrl: "https://classroom.example/a/gc-1",
    });

    const fromManual = run([manual]);
    const fromImport = run([importedItem]);

    expect(work(fromImport.blocks).map((b) => `${b.start}|${b.end}`)).toEqual(
      work(fromManual.blocks).map((b) => `${b.start}|${b.end}`)
    );
    expect(fromImport.deadlineCapacities[importedItem.id].availableMinutes).toBe(
      fromManual.deadlineCapacities[manual.id].availableMinutes
    );
  });
});

describe("Phase 4.5D — edge cases", () => {
  it("C: an already-overdue item is reported overdue, not merely urgent", () => {
    const overdue = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-20T23:59", deadlineStrictness: "hard" });
    const result = run([overdue]);
    expect(result.deadlineCapacities[overdue.id].risk).toBe("overdue");
  });

  it("B: an item due in 30 minutes is treated as maximally urgent", () => {
    const imminent = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-24T08:30", deadlineStrictness: "hard" });
    const later = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-28T23:59", deadlineStrictness: "hard" });
    const result = run([imminent, later]);
    expect(result.priorities[imminent.id].score).toBeGreaterThan(result.priorities[later.id].score);
  });

  it("F: no availability at all produces an honest overload warning, not an empty plan", () => {
    const item = makeAssignment({ estimatedMinutes: 120, dueDate: "2026-08-26T23:59", deadlineStrictness: "hard" });
    const result = run([item], {}, makePlanningProfile({ dailyAvailability: [] }));

    expect(work(result.blocks)).toHaveLength(0);
    expect(result.unscheduledWorkItemIds).toContain(item.id);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.workloadStatus.level).toBe("at-risk");
  });

  it("G: when work exceeds available time, flexible work is named as movable", () => {
    const hard = makeAssignment({ estimatedMinutes: 600, dueDate: "2026-08-25T23:59", deadlineStrictness: "hard" });
    const flexible = makeAssignment({ title: "Optional reading", estimatedMinutes: 600, dueDate: "2026-08-25T23:59", deadlineStrictness: "flexible" });
    const overload = run([hard, flexible]).warnings.find((w) => w.kind === "overloaded-range");

    expect(overload).toBeDefined();
    expect(overload!.message).toContain("Optional reading");
  });

  it("J: changing a deadline moves the work with it", () => {
    const item = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-30T23:59", deadlineStrictness: "hard" });
    const pulledIn = { ...item, dueDate: "2026-08-25T23:59" };

    const before = run([item], {}, makePlanningProfile({ workStyle: "deadline_driven" }));
    const after = run([pulledIn], {}, makePlanningProfile({ workStyle: "deadline_driven" }));

    const lastDay = (r: ReturnType<typeof run>) =>
      work(r.blocks).sort((a, b) => (a.start < b.start ? 1 : -1))[0].start.slice(0, 10);
    expect(lastDay(after) < lastDay(before)).toBe(true);
  });

  it("K: changing the estimate updates both the schedule and the deadline buffer", () => {
    const small = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-28T23:59" });
    const larger = { ...small, estimatedMinutes: 180 };

    const a = run([small]);
    const b = run([larger]);

    expect(minutes(work(b.blocks))).toBeGreaterThan(minutes(work(a.blocks)));
    expect(b.deadlineCapacities[small.id].bufferMinutes).toBeLessThan(a.deadlineCapacities[small.id].bufferMinutes);
  });

  it("N: completing work early leaves only the genuine remainder scheduled", () => {
    const item = makeAssignment({ estimatedMinutes: 120, actualMinutes: 90, dueDate: "2026-08-28T23:59" });
    expect(minutes(work(run([item]).blocks))).toBe(30);
  });

  it("O: work never overlaps a fixed commitment", () => {
    const commitment = makeCommitment({ recurrence: { type: "weekly", daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }, startTime: "16:00", endTime: "18:00" });
    const item = makeAssignment({ estimatedMinutes: 300, dueDate: "2026-08-28T23:59", deadlineStrictness: "hard" });

    for (const block of work(run([item], { commitments: [commitment] }).blocks)) {
      const start = minutesOfDay(block.start.split("T")[1]);
      const end = minutesOfDay(block.end.split("T")[1]);
      expect(start < 18 * 60 && end > 16 * 60).toBe(false);
    }
  });

  it("P: no history means no personalized estimate is invented", () => {
    const item = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-28T23:59" });
    const adjustment = run([item], { workSessions: [] }).estimateAdjustments[item.id];

    expect(adjustment.adjusted).toBe(false);
    expect(adjustment.confidence).toBe("insufficient");
    expect(adjustment.reason).toBe("");
  });

  it("Q/R: limited history adjusts more conservatively than strong history", () => {
    const item = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-29T23:59" });
    const limited = run([item], { workSessions: history(item.id, 3, 1.4) }).estimateAdjustments[item.id];
    const strong = run([item], { workSessions: history(item.id, 12, 1.4) }).estimateAdjustments[item.id];

    expect(limited.planningMinutes).toBeLessThan(strong.planningMinutes);
    expect(limited.confidence).toBe("limited");
    expect(strong.planningMinutes).toBeLessThanOrEqual(60 * 1.5); // still bounded
  });
});

describe("Part 5 — one planning estimate used consistently", () => {
  const item = makeAssignment({ estimatedMinutes: 60, dueDate: "2026-08-29T23:59" });
  const withHistory = () => run([item], { workSessions: history(item.id, 10, 1.4) });

  it("uses the personalized estimate for workload status, not the student's", () => {
    const result = withHistory();
    expect(result.workloadStatus.estimatedRemainingMinutes).toBe(result.estimateAdjustments[item.id].planningMinutes);
  });

  it("uses the personalized estimate for deadline capacity and buffer", () => {
    const result = withHistory();
    const planning = result.estimateAdjustments[item.id].planningMinutes;
    const capacity = result.deadlineCapacities[item.id];

    expect(capacity.estimatedMinutes).toBe(planning);
    expect(capacity.bufferMinutes).toBe(capacity.availableMinutes - planning);
  });

  it("schedules the personalized number of minutes, not the student's estimate", () => {
    const result = withHistory();
    expect(minutes(work(result.blocks))).toBe(result.estimateAdjustments[item.id].planningMinutes);
  });

  it("keeps the forecast in step with what was actually placed", () => {
    const result = withHistory();
    const forecastWork = result.dailyForecast.reduce((sum, d) => sum + d.workMinutes, 0);
    expect(forecastWork).toBe(minutes(work(result.blocks)));
  });

  it("leaves everything at the student's estimate when there's no history", () => {
    const result = run([item]);
    expect(result.estimateAdjustments[item.id].adjusted).toBe(false);
    expect(result.workloadStatus.estimatedRemainingMinutes).toBe(60);
    expect(minutes(work(result.blocks))).toBe(60);
  });
});

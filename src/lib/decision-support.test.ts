import { describe, expect, it } from "vitest";
import {
  bestUseOfTime,
  buildDayHealth,
  buildEarlyFinishSummary,
  buildOverrunImpact,
  buildWhyNow,
  freeMinutesToday,
  previewMove,
  recommendStartDate,
  summarizeBuffer,
  summarizeWeek,
} from "./decision-support";
import { generateSchedule, type GenerateScheduleInput } from "@/scheduling-engine";
import {
  makeAssignment,
  makeCommitment,
  makePlanningProfile,
  makeProject,
  makeTest,
  NOW,
} from "@/scheduling-engine/__tests__/fixtures";
import type { PlanningProfile, ScheduleBlock, WorkStage } from "@/types/models";
import type { SchedulableWorkItem } from "@/scheduling-engine";

// NOW is Monday 2026-08-24T08:00; the fixture profile allows 15:00-21:00 every day.
const WEEK_START = "2026-08-24";
const WEEK_END = "2026-08-30";

function buildInput(
  workItems: SchedulableWorkItem[],
  overrides: Partial<GenerateScheduleInput> = {},
  profile: PlanningProfile = makePlanningProfile()
): GenerateScheduleInput {
  return {
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
  };
}

describe("summarizeBuffer (Part 3/4)", () => {
  it("states a comfortable buffer in plain language", () => {
    const item = makeAssignment({ dueDate: "2026-08-27T23:59", estimatedMinutes: 60 });
    const result = generateSchedule(buildInput([item]));
    const summary = summarizeBuffer(result.deadlineCapacities[item.id]);

    expect(summary.label).toBe("Comfortable");
    expect(summary.sentence).toMatch(/buffer before this deadline/);
  });

  it("states a shortfall as a concrete amount rather than an alarm", () => {
    const item = makeAssignment({ dueDate: "2026-08-24T21:00", estimatedMinutes: 600, deadlineStrictness: "hard" });
    const result = generateSchedule(buildInput([item]));
    const summary = summarizeBuffer(result.deadlineCapacities[item.id]);

    expect(summary.label).toBe("At risk");
    expect(summary.sentence).toMatch(/short of the time needed/);
    // Calm, practical language — no exclamation or scare wording.
    expect(summary.sentence).not.toMatch(/!|urgent|panic/i);
  });

  it("uses the engine's own risk classification rather than recomputing one", () => {
    const item = makeAssignment({ dueDate: "2026-08-24T21:00", estimatedMinutes: 330 });
    const result = generateSchedule(buildInput([item]));
    const capacity = result.deadlineCapacities[item.id];
    expect(summarizeBuffer(capacity).label).toBe(
      capacity.risk === "tight" ? "Tight" : capacity.risk === "at-risk" ? "At risk" : "Comfortable"
    );
  });
});

describe("buildWhyNow (Part 2)", () => {
  it("gives deadline-based reasoning for imminent work", () => {
    const item = makeAssignment({ dueDate: "2026-08-24T21:00", estimatedMinutes: 60, deadlineStrictness: "hard" });
    const result = generateSchedule(buildInput([item]));
    const block = result.blocks.find((b) => b.workItemId === item.id)!;
    const reasons = buildWhyNow(block, result, NOW);

    expect(reasons.some((r) => r.includes("within the next day"))).toBe(true);
  });

  it("gives workload-based reasoning when real work remains", () => {
    const item = makeAssignment({ dueDate: "2026-08-27T23:59", estimatedMinutes: 90 });
    const result = generateSchedule(buildInput([item]));
    const block = result.blocks.find((b) => b.workItemId === item.id)!;
    expect(buildWhyNow(block, result, NOW).some((r) => r.includes("of work still remains"))).toBe(true);
  });

  it("gives buffer-based reasoning, matching the engine's risk read", () => {
    const item = makeAssignment({ dueDate: "2026-08-24T21:00", estimatedMinutes: 600, deadlineStrictness: "hard" });
    const result = generateSchedule(buildInput([item]));
    const block = result.blocks.find((b) => b.workItemId === item.id)!;
    expect(buildWhyNow(block, result, NOW).some((r) => r.includes("short"))).toBe(true);
  });

  it("fabricates nothing for a block with no work item behind it", () => {
    const item = makeAssignment({ estimatedMinutes: 60 });
    const result = generateSchedule(buildInput([item]));
    const breakBlock = result.blocks.find((b) => b.origin === "break");
    if (breakBlock) expect(buildWhyNow(breakBlock, result, NOW)).toEqual([]);
  });

  it("only claims later sessions exist when there genuinely are some", () => {
    const single = makeAssignment({ dueDate: "2026-08-27T23:59", estimatedMinutes: 30 });
    const result = generateSchedule(buildInput([single]));
    const blocks = result.blocks.filter((b) => b.workItemId === single.id).sort((a, b) => (a.start < b.start ? -1 : 1));
    const last = blocks[blocks.length - 1];
    expect(buildWhyNow(last, result, NOW).some((r) => r.includes("follow"))).toBe(false);
  });
});

describe("previewMove (Part 5/6)", () => {
  const item = makeAssignment({ dueDate: "2026-08-26T21:00", estimatedMinutes: 120, deadlineStrictness: "hard" });

  it("does not mutate the real schedule or its inputs", () => {
    const input = buildInput([item]);
    const result = generateSchedule(input);
    const block = result.blocks.find((b) => b.workItemId === item.id)!;

    const inputSnapshot = JSON.stringify(input);
    const resultSnapshot = JSON.stringify(result.blocks);

    previewMove(input, result, block, "move-to-tomorrow");

    expect(JSON.stringify(input)).toBe(inputSnapshot);
    expect(JSON.stringify(result.blocks)).toBe(resultSnapshot);
  });

  it("reports the time freed today and a real change summary", () => {
    const input = buildInput([item]);
    const result = generateSchedule(input);
    const block = result.blocks.find((b) => b.workItemId === item.id)!;
    const preview = previewMove(input, result, block, "move-to-tomorrow");

    expect(preview.minutesFreedToday).toBeGreaterThan(0);
    expect(preview.changes).toHaveProperty("changes");
  });

  it("recalculates buffer against the deadline after the move", () => {
    const input = buildInput([item]);
    const result = generateSchedule(input);
    const block = result.blocks.find((b) => b.workItemId === item.id)!;
    const preview = previewMove(input, result, block, "move-to-tomorrow");

    expect(preview.bufferBeforeMinutes).not.toBeNull();
    expect(preview.bufferAfterMinutes).not.toBeNull();
    // Pinning the session later consumes usable time before the deadline, so buffer cannot grow.
    expect(preview.bufferAfterMinutes!).toBeLessThanOrEqual(preview.bufferBeforeMinutes!);
  });

  it("reports a shortfall when moving genuinely breaks the deadline", () => {
    // Due tonight: moving this session to tomorrow puts it past the deadline entirely.
    const tonight = makeAssignment({ dueDate: "2026-08-24T21:00", estimatedMinutes: 120, deadlineStrictness: "hard" });
    const input = buildInput([tonight]);
    const result = generateSchedule(input);
    const block = result.blocks.find((b) => b.workItemId === tonight.id)!;
    const preview = previewMove(input, result, block, "move-to-tomorrow");

    expect(preview.verdict).toBe("shortfall");
    expect(preview.headline).toMatch(/less time than the work needs/);
  });

  it("leaves existing manual overrides intact in the preview", () => {
    const override: ScheduleBlock = {
      id: "manual_1",
      userId: "u1",
      workItemId: "other",
      title: "Pinned elsewhere",
      start: "2026-08-25T15:00",
      end: "2026-08-25T16:00",
      origin: "manual-override",
      status: "planned",
    };
    const input = buildInput([item], { existingBlocks: [override] });
    const result = generateSchedule(input);
    const block = result.blocks.find((b) => b.workItemId === item.id)!;

    previewMove(input, result, block, "move-to-tomorrow");
    expect(input.existingBlocks).toContainEqual(override);
  });
});

describe("bestUseOfTime (Part 7)", () => {
  const stages: WorkStage[] = [];

  it("finds work that fits a 15-minute window", () => {
    const small = makeAssignment({ dueDate: "2026-08-25T23:59", estimatedMinutes: 15 });
    const result = generateSchedule(buildInput([small]));
    const suggestion = bestUseOfTime(15, result, [small], stages, NOW);

    expect(suggestion).not.toBeNull();
    expect(suggestion!.minutes).toBeLessThanOrEqual(15);
    expect(suggestion!.partial).toBe(false);
  });

  it("finds work for a 30-minute window", () => {
    const item = makeAssignment({ dueDate: "2026-08-25T23:59", estimatedMinutes: 30 });
    const result = generateSchedule(buildInput([item]));
    const suggestion = bestUseOfTime(30, result, [item], stages, NOW);
    expect(suggestion!.minutes).toBeLessThanOrEqual(30);
  });

  it("finds work for a 60-minute window", () => {
    const item = makeAssignment({ dueDate: "2026-08-25T23:59", estimatedMinutes: 55 });
    const result = generateSchedule(buildInput([item]));
    const suggestion = bestUseOfTime(60, result, [item], stages, NOW);
    expect(suggestion!.minutes).toBeLessThanOrEqual(60);
  });

  it("returns nothing when there is no work at all", () => {
    const result = generateSchedule(buildInput([]));
    expect(bestUseOfTime(30, result, [], stages, NOW)).toBeNull();
  });

  it("never recommends a non-splittable session that cannot fit the window", () => {
    // Homework is not splittable by default, and a 45-minute session can't fit 15 minutes.
    const homework = makeAssignment({ dueDate: "2026-08-25T23:59", estimatedMinutes: 45, workType: "homework" });
    const result = generateSchedule(buildInput([homework]));
    const suggestion = bestUseOfTime(15, result, [homework], stages, NOW);

    if (suggestion) expect(suggestion.minutes).toBeLessThanOrEqual(15);
    else expect(suggestion).toBeNull();
  });

  it("offers a partial sitting for splittable work that exceeds the window", () => {
    const project = makeProject({ dueDate: "2026-08-30T23:59", estimatedMinutes: 240 });
    const result = generateSchedule(buildInput([project]));
    const suggestion = bestUseOfTime(20, result, [project], stages, NOW);

    expect(suggestion).not.toBeNull();
    expect(suggestion!.partial).toBe(true);
    expect(suggestion!.minutes).toBe(20);
  });

  it("respects commitments, since suggestions come only from engine-placed sessions", () => {
    const busyAllWeek = makeCommitment({
      recurrence: { type: "weekly", daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
      startTime: "15:00",
      endTime: "21:00",
    });
    const item = makeAssignment({ dueDate: "2026-08-26T23:59", estimatedMinutes: 60 });
    const result = generateSchedule(buildInput([item], { commitments: [busyAllWeek] }));

    // Nothing could be placed, so nothing can be suggested — no invented work.
    expect(bestUseOfTime(60, result, [item], stages, NOW)).toBeNull();
  });

  it("never recommends completed work", () => {
    const done = makeAssignment({ dueDate: "2026-08-25T23:59", estimatedMinutes: 30, status: "completed" });
    const result = generateSchedule(buildInput([done]));
    expect(bestUseOfTime(60, result, [done], stages, NOW)).toBeNull();
  });
});

describe("recommendStartDate (Part 8)", () => {
  it("recommends a start for a large multi-session project, from the real plan", () => {
    const project = makeProject({ dueDate: "2026-08-30T23:59", estimatedMinutes: 300 });
    const result = generateSchedule(buildInput([project]));
    const recommendation = recommendStartDate(project, result, []);

    expect(recommendation).not.toBeNull();
    const firstBlock = result.blocks
      .filter((b) => b.workItemId === project.id)
      .sort((a, b) => (a.start < b.start ? -1 : 1))[0];
    // The recommendation must match what the engine actually planned, not an invented date.
    expect(recommendation!.startDate).toBe(firstBlock.start.slice(0, 10));
    expect(recommendation!.sessionCount).toBeGreaterThan(1);
  });

  it("stays silent for a small single-session assignment", () => {
    const small = makeAssignment({ dueDate: "2026-08-25T23:59", estimatedMinutes: 30 });
    const result = generateSchedule(buildInput([small]));
    expect(recommendStartDate(small, result, [])).toBeNull();
  });

  it("honors a preferred start date, since the engine already applied it", () => {
    const project = makeProject({
      dueDate: "2026-08-30T23:59",
      estimatedMinutes: 300,
      preferredStartDate: "2026-08-27",
    });
    const result = generateSchedule(buildInput([project]));
    const recommendation = recommendStartDate(project, result, []);
    if (recommendation) expect(recommendation.startDate >= "2026-08-27").toBe(true);
  });

  it("accounts for a decomposed item's stages", () => {
    const project = makeProject({ dueDate: "2026-08-30T23:59", estimatedMinutes: 300 });
    const stages: WorkStage[] = [
      { id: "s0", workItemId: project.id, title: "Research", stageType: "research", order: 0, estimatedMinutes: 300, status: "not-started" },
    ];
    const result = generateSchedule(buildInput([project], { stages }));
    const recommendation = recommendStartDate(project, result, stages);
    // The stage's blocks carry the stage id, so this must still resolve back to the parent item.
    expect(recommendation).not.toBeNull();
    expect(recommendation!.workItemId).toBe(project.id);
  });
});

describe("weekly health and week summary (Part 9/10)", () => {
  it("reports an on-track week with a real buffer figure", () => {
    const item = makeAssignment({ dueDate: "2026-08-28T23:59", estimatedMinutes: 60 });
    const result = generateSchedule(buildInput([item]));
    const summary = summarizeWeek(result);

    expect(summary.level).toBe("on-track");
    expect(summary.headline).toBe("Your week is on track.");
    expect(summary.detail).toMatch(/buffer/);
  });

  it("reports an at-risk week when hard-deadline work cannot fit", () => {
    const impossible = makeAssignment({ dueDate: "2026-08-24T21:00", estimatedMinutes: 3000, deadlineStrictness: "hard" });
    const result = generateSchedule(buildInput([impossible]));
    const summary = summarizeWeek(result);

    expect(summary.level).toBe("at-risk");
    expect(summary.headline).toBe("You're currently at risk.");
  });

  it("reports being caught up without inventing work", () => {
    const result = generateSchedule(buildInput([]));
    const summary = summarizeWeek(result);
    expect(summary.level).toBe("ahead");
    expect(summary.detail).toMatch(/no estimated work left/);
  });

  it("builds per-day health from the engine's own forecast", () => {
    const item = makeAssignment({ dueDate: "2026-08-28T23:59", estimatedMinutes: 120 });
    const result = generateSchedule(buildInput([item]));
    const days = buildDayHealth(result);

    expect(days).toHaveLength(result.dailyForecast.length);
    days.forEach((day, i) => {
      expect(day.workMinutes).toBe(result.dailyForecast[i].workMinutes);
      expect(day.bufferMinutes).toBe(result.dailyForecast[i].availableMinutes - result.dailyForecast[i].workMinutes);
    });
  });

  it("flags a day planned beyond its available time as over capacity", () => {
    const heavy = makeAssignment({ dueDate: "2026-08-24T21:00", estimatedMinutes: 600, deadlineStrictness: "hard" });
    const result = generateSchedule(buildInput([heavy]));
    const days = buildDayHealth(result);
    expect(days.every((d) => d.bufferMinutes >= 0 || d.status === "over-capacity")).toBe(true);
  });
});

describe("free time protection (Part 11)", () => {
  it("reports free wall-clock time, not leftover capacity", () => {
    // The fixture profile allows 15:00-21:00 (360 min) and NOW is 08:00, so the whole window is
    // still ahead. With 60 minutes of work placed, 300 genuinely remain free.
    //
    // This deliberately does NOT match `dailyForecast.availableMinutes - workMinutes`: that figure
    // is capped at the daily capacity *target* (135 for "moderate"), so the old formula reported
    // 75 minutes to a student who actually had five hours of evening left.
    const item = makeAssignment({ dueDate: "2026-08-28T23:59", estimatedMinutes: 60 });
    const result = generateSchedule(buildInput([item]));

    expect(freeMinutesToday(result)).toBe(300);

    const todayForecast = result.dailyForecast.find((d) => d.date === "2026-08-24")!;
    expect(freeMinutesToday(result)).toBeGreaterThan(todayForecast.availableMinutes - todayForecast.workMinutes);
  });

  it("counts only the part of the day that is still ahead", () => {
    const item = makeAssignment({ dueDate: "2026-08-28T23:59", estimatedMinutes: 60 });
    const morning = generateSchedule(buildInput([item]));
    const evening = generateSchedule(buildInput([item], { now: "2026-08-24T19:00" }));

    // The window is 15:00-21:00 (360 min); by 19:00 only 120 of those minutes are left. The engine
    // never places new work before "now" (Phase 5D, Part 1), so the 60-minute session lands inside
    // the remaining 19:00-21:00 window rather than sitting stale back at 15:00 — leaving 60 of the
    // 120 remaining minutes genuinely free, not the full 120.
    expect(freeMinutesToday(evening)).toBeLessThan(freeMinutesToday(morning));
    expect(freeMinutesToday(evening)).toBe(60);
  });

  it("reports no free time once the availability window has closed", () => {
    const item = makeAssignment({ dueDate: "2026-08-28T23:59", estimatedMinutes: 60 });
    expect(freeMinutesToday(generateSchedule(buildInput([item], { now: "2026-08-24T22:00" })))).toBe(0);
  });

  it("does not consume protected free time just because tolerance is high", () => {
    const item = makeAssignment({ dueDate: "2026-08-30T23:59", estimatedMinutes: 60 });
    const heavyTolerance = generateSchedule(
      buildInput([item], {}, makePlanningProfile({ workloadTolerance: "heavy", freeTimePriority: "low" }))
    );
    // Only 60 minutes of work exists; a high tolerance must not manufacture more.
    expect(heavyTolerance.workloadStatus.estimatedRemainingMinutes).toBe(60);
    expect(freeMinutesToday(heavyTolerance)).toBeGreaterThan(0);
  });
});

describe("Planning Profile differences (Part 12)", () => {
  const project = () => makeProject({ dueDate: "2026-08-30T23:59", estimatedMinutes: 300, deadlineStrictness: "important" });

  it("gives minimal-break students longer sessions than frequent-break students", () => {
    const minimal = generateSchedule(
      buildInput([project()], {}, makePlanningProfile({ breakPreference: "minimal", workloadTolerance: "heavy" }))
    );
    const frequent = generateSchedule(
      buildInput([project()], {}, makePlanningProfile({ breakPreference: "frequent", workloadTolerance: "heavy" }))
    );

    const longest = (r: typeof minimal) =>
      Math.max(
        ...r.blocks
          .filter((b) => b.origin === "generated")
          .map((b) => {
            const [sh, sm] = b.start.split("T")[1].split(":").map(Number);
            const [eh, em] = b.end.split("T")[1].split(":").map(Number);
            return eh * 60 + em - (sh * 60 + sm);
          })
      );

    expect(longest(minimal)).toBeGreaterThan(longest(frequent));
  });

  it("concentrates work later for a deadline-driven student than an early one", () => {
    const early = generateSchedule(buildInput([project()], {}, makePlanningProfile({ workStyle: "early" })));
    const deadlineDriven = generateSchedule(
      buildInput([project()], {}, makePlanningProfile({ workStyle: "deadline_driven" }))
    );

    const firstDay = (r: typeof early) =>
      r.blocks.filter((b) => b.origin === "generated").sort((a, b) => (a.start < b.start ? -1 : 1))[0]?.start.slice(0, 10);

    expect(firstDay(deadlineDriven)! >= firstDay(early)!).toBe(true);
  });

  it("protects more free time for a high free-time-priority student", () => {
    const highFreeTime = generateSchedule(
      buildInput([project()], {}, makePlanningProfile({ freeTimePriority: "high" }))
    );
    const lowFreeTime = generateSchedule(buildInput([project()], {}, makePlanningProfile({ freeTimePriority: "low" })));

    const firstDayWork = (r: typeof highFreeTime) => r.dailyForecast[0].workMinutes;
    expect(firstDayWork(highFreeTime)).toBeLessThanOrEqual(firstDayWork(lowFreeTime));
  });
});

describe("test-prep buffer reflects the real exam time", () => {
  it("gives a 9 AM exam less usable prep time than a 3 PM one", () => {
    const morning = makeTest({ dueDate: "2026-08-26T09:00", estimatedMinutes: 120 });
    const afternoon = makeTest({ dueDate: "2026-08-26T19:00", estimatedMinutes: 120 });

    const morningResult = generateSchedule(buildInput([morning]));
    const afternoonResult = generateSchedule(buildInput([afternoon]));

    expect(morningResult.deadlineCapacities[morning.id].availableMinutes).toBeLessThan(
      afternoonResult.deadlineCapacities[afternoon.id].availableMinutes
    );
  });
});

describe("Phase 5D, Scenarios B/C/D — finishing a session early", () => {
  it("says nothing at all for a trivially small gap (Part 18: no noise)", () => {
    const result = generateSchedule(buildInput([]));
    expect(buildEarlyFinishSummary(60, 58, result, [], [], NOW, "medium")).toBeNull();
  });

  it("returns null when there was no planned duration to compare against", () => {
    const result = generateSchedule(buildInput([]));
    expect(buildEarlyFinishSummary(null, 20, result, [], [], NOW, "medium")).toBeNull();
  });

  it("Scenario C — caught up: keeps the freed time free and suggests nothing", () => {
    const result = generateSchedule(buildInput([])); // no work at all → caughtUp
    expect(result.caughtUp).toBe(true);
    const summary = buildEarlyFinishSummary(60, 35, result, [], [], NOW, "medium");
    expect(summary?.suggestion).toBeNull();
    expect(summary?.detail).toMatch(/keep the time free/i);
    expect(summary?.freedMinutes).toBe(25);
  });

  it("respects a high free-time priority even when not caught up", () => {
    // Narrow, single-day range with more work than fits — genuinely not caught up.
    const items = [
      makeAssignment({ dueDate: "2026-08-24T23:59", estimatedMinutes: 400, deadlineStrictness: "flexible" }),
      makeTest({ dueDate: "2026-08-24T23:59", estimatedMinutes: 400, deadlineStrictness: "hard" }),
    ];
    const result = generateSchedule(
      buildInput(items, { rangeStart: "2026-08-24", rangeEnd: "2026-08-24" }, makePlanningProfile({ freeTimePriority: "high" }))
    );
    expect(result.caughtUp).toBe(false);
    const summary = buildEarlyFinishSummary(60, 35, result, items, [], NOW, "high");
    expect(summary?.suggestion).toBeNull();
    expect(summary?.detail).toMatch(/keep the time free/i);
  });

  it("Scenario D — behind: offers a real already-placed session that fits the freed window", () => {
    // A big flexible item overflows the single-day range (genuinely not caught up), while a small,
    // higher-priority item still gets placed and is small enough to fit a 25-minute freed window.
    const small = makeAssignment({
      title: "History reading",
      dueDate: "2026-08-24T23:59",
      estimatedMinutes: 20,
      deadlineStrictness: "hard",
      weight: "high",
    });
    const big = makeAssignment({
      title: "Big project",
      dueDate: "2026-08-24T23:59",
      estimatedMinutes: 400,
      deadlineStrictness: "flexible",
    });
    const result = generateSchedule(buildInput([small, big], { rangeStart: "2026-08-24", rangeEnd: "2026-08-24" }));
    expect(result.caughtUp).toBe(false);

    const summary = buildEarlyFinishSummary(60, 35, result, [small, big], [], NOW, "medium");
    expect(summary?.suggestion).not.toBeNull();
    expect(summary?.suggestion?.block.workItemId).toBe(small.id);
    expect(summary?.detail).toContain("History reading");
  });

  it("names the deadline-protection reason when the suggested item's own capacity is genuinely tight", () => {
    // A single, narrow day so the suggested item's own deadline capacity is genuinely tight, not
    // just the week-level workload — 27 available minutes against 25 needed is inside
    // DEADLINE_COMFORT_FACTOR (1.15x), i.e. "tight" rather than "comfortable".
    const narrowProfile = makePlanningProfile({
      dailyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, earliest: "15:00", latest: "15:27" })),
    });
    const urgent = makeAssignment({
      title: "Urgent reading",
      dueDate: "2026-08-24T15:27",
      estimatedMinutes: 25,
      deadlineStrictness: "hard",
    });
    // Not caught up — otherwise buildEarlyFinishSummary short-circuits to "keep it free" before
    // ever reaching the suggestion branch this test exercises.
    const overflow = makeAssignment({
      title: "Overflow work",
      dueDate: "2026-08-24T23:59",
      estimatedMinutes: 300,
      deadlineStrictness: "flexible",
    });
    const result = generateSchedule(
      buildInput([urgent, overflow], { rangeStart: "2026-08-24", rangeEnd: "2026-08-24" }, narrowProfile)
    );
    const summary = buildEarlyFinishSummary(60, 35, result, [urgent, overflow], [], NOW, "medium");
    expect(summary?.suggestion?.block.workItemId).toBe(urgent.id);
    expect(summary?.detail).toMatch(/helps protect its deadline/);
  });

  it("never invents work when nothing real fits the freed window", () => {
    // A single large, unsplittable, already-placed item overflows a single day (not caught up),
    // but its own session chunks are far bigger than a tiny 15-minute freed window — nothing fits.
    const big = makeAssignment({
      title: "Big project",
      dueDate: "2026-08-24T23:59",
      estimatedMinutes: 600,
      deadlineStrictness: "important",
      workType: "homework",
      splittable: false,
    });
    const result = generateSchedule(buildInput([big], { rangeStart: "2026-08-24", rangeEnd: "2026-08-24" }));
    expect(result.caughtUp).toBe(false);
    const summary = buildEarlyFinishSummary(20, 5, result, [big], [], NOW, "medium");
    expect(summary?.suggestion).toBeNull();
    expect(summary?.detail).toMatch(/nothing else fits/i);
  });
});

describe("Phase 6B, Part 6 — buildOverrunImpact (taking longer than planned)", () => {
  // A deliberately narrow single day so a real overrun genuinely squeezes what's left.
  const narrowProfile = makePlanningProfile({
    dailyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, earliest: "15:00", latest: "16:00" })),
  });

  it("says nothing for a trivial overrun (Part 8: no noise)", () => {
    const a = makeAssignment({ title: "First task", dueDate: "2026-08-24T23:59", estimatedMinutes: 30 });
    const b = makeAssignment({ title: "Second task", dueDate: "2026-08-24T16:00", estimatedMinutes: 30, deadlineStrictness: "hard" });
    const before = generateSchedule(
      buildInput([a, b], { rangeStart: "2026-08-24", rangeEnd: "2026-08-24", now: "2026-08-24T14:00" }, narrowProfile)
    );
    const after = generateSchedule(
      buildInput(
        [{ ...a, status: "completed", actualMinutes: 32 }, b],
        { rangeStart: "2026-08-24", rangeEnd: "2026-08-24", now: "2026-08-24T15:32" },
        narrowProfile
      )
    );
    expect(buildOverrunImpact(30, 32, before, after, "2026-08-24")).toBeNull();
  });

  it("returns null when there was no planned duration to compare against", () => {
    const result = generateSchedule(buildInput([]));
    expect(buildOverrunImpact(null, 40, result, result, "2026-08-24")).toBeNull();
  });

  it("names the later-today item that genuinely no longer fits comfortably", () => {
    const a = makeAssignment({ title: "First task", dueDate: "2026-08-24T23:59", estimatedMinutes: 30 });
    const b = makeAssignment({ title: "Second task", dueDate: "2026-08-24T16:00", estimatedMinutes: 30, deadlineStrictness: "hard" });

    // Before: planned from 14:00, the full 15:00-16:00 hour is available — B fits comfortably
    // right after A.
    const before = generateSchedule(
      buildInput([a, b], { rangeStart: "2026-08-24", rangeEnd: "2026-08-24", now: "2026-08-24T14:00" }, narrowProfile)
    );
    // After: A ran 20 minutes over (50 instead of 30) and is now complete; by the time it's
    // logged, "now" is 15:50 — only 10 of B's needed 30 minutes remain before its 16:00 deadline.
    const after = generateSchedule(
      buildInput(
        [{ ...a, status: "completed", actualMinutes: 50 }, b],
        { rangeStart: "2026-08-24", rangeEnd: "2026-08-24", now: "2026-08-24T15:50" },
        narrowProfile
      )
    );

    const impact = buildOverrunImpact(30, 50, before, after, "2026-08-24");
    expect(impact).not.toBeNull();
    expect(impact?.overrunMinutes).toBe(20);
    expect(impact?.headline).toMatch(/20m longer than planned/);
    expect(impact?.detail).toContain("Second task");
    expect(impact?.affectedWorkItemId).toBe(b.id);
  });

  it("says nothing when the later item still fits comfortably despite the overrun", () => {
    // A generous day — running a bit over on A still leaves plenty of room for B.
    const roomyProfile = makePlanningProfile({
      dailyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, earliest: "10:00", latest: "20:00" })),
    });
    const a = makeAssignment({ title: "First task", dueDate: "2026-08-24T23:59", estimatedMinutes: 30 });
    const b = makeAssignment({ title: "Second task", dueDate: "2026-08-25T23:59", estimatedMinutes: 30, deadlineStrictness: "hard" });

    const before = generateSchedule(
      buildInput([a, b], { rangeStart: "2026-08-24", rangeEnd: "2026-08-25", now: "2026-08-24T10:00" }, roomyProfile)
    );
    const after = generateSchedule(
      buildInput(
        [{ ...a, status: "completed", actualMinutes: 60 }, b],
        { rangeStart: "2026-08-24", rangeEnd: "2026-08-25", now: "2026-08-24T11:00" },
        roomyProfile
      )
    );

    expect(buildOverrunImpact(30, 60, before, after, "2026-08-24")).toBeNull();
  });
});

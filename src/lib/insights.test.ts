import { describe, expect, it } from "vitest";
import {
  calculateAverageWeeklyWorkloadMinutes,
  calculateBusiestDayOfWeek,
  calculateEstimateAccuracy,
  calculateFeedbackTally,
  calculatePostponementRate,
  calculateTypicalWorkWindow,
  calculateAccuracyByWorkType,
  MIN_SESSIONS_FOR_CATEGORY_INSIGHT,
  MIN_SESSIONS_FOR_HABIT_INSIGHT,
} from "./insights";
import type { ScheduleFeedback, WorkSession } from "@/types/models";

function makeSession(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: `s${Math.random()}`,
    userId: "u1",
    workItemId: "w1",
    start: "2026-08-24T16:00",
    end: "2026-08-24T16:45",
    plannedMinutes: 45,
    minutesSpent: 45,
    ...overrides,
  };
}

describe("calculateEstimateAccuracy", () => {
  it("returns null with no data", () => {
    expect(calculateEstimateAccuracy([])).toBeNull();
  });

  it("averages estimated and actual minutes correctly", () => {
    const sessions = [
      makeSession({ plannedMinutes: 30, minutesSpent: 40 }),
      makeSession({ plannedMinutes: 60, minutesSpent: 50 }),
    ];
    const result = calculateEstimateAccuracy(sessions);
    expect(result).not.toBeNull();
    expect(result!.avgEstimatedMinutes).toBe(45);
    expect(result!.avgActualMinutes).toBe(45);
    expect(result!.avgDiffMinutes).toBe(0);
  });

  it("treats a decomposed work item's stage-scoped sessions the same as any other (Phase 4, Part 25-27)", () => {
    // A stage's sessions carry the stage's id as workItemId (see scheduling-engine/decomposition.ts)
    // — this function is generic over workItemId, so stage data contributes to estimate accuracy
    // exactly once each, with no special-casing and no double counting.
    const sessions = [
      makeSession({ workItemId: "p1_stage_2", plannedMinutes: 60, minutesSpent: 75 }),
      makeSession({ workItemId: "regular_item", plannedMinutes: 30, minutesSpent: 30 }),
    ];
    const result = calculateEstimateAccuracy(sessions);
    expect(result).not.toBeNull();
    expect(result!.sessionCount).toBe(2);
    expect(result!.avgEstimatedMinutes).toBe(45);
    expect(result!.avgActualMinutes).toBe(Math.round((75 + 30) / 2));
  });

  it("ignores sessions without both an estimate and an actual", () => {
    const sessions = [makeSession({ plannedMinutes: 30, minutesSpent: 40 }), makeSession({ postponed: true, minutesSpent: undefined })];
    expect(calculateEstimateAccuracy(sessions)!.sessionCount).toBe(1);
  });
});

describe("calculateAccuracyByWorkType (Phase 4.5C)", () => {
  const homework = { id: "hw", workType: "homework" as const };
  const reading = { id: "rd", workType: "reading" as const };

  it("stays silent for categories below the minimum sample size", () => {
    const sessions = Array.from({ length: MIN_SESSIONS_FOR_CATEGORY_INSIGHT - 1 }, () =>
      makeSession({ workItemId: "hw", plannedMinutes: 40, minutesSpent: 60 })
    );
    expect(calculateAccuracyByWorkType(sessions, [homework])).toEqual([]);
  });

  it("reports a category once there's enough real data", () => {
    const sessions = Array.from({ length: 5 }, () =>
      makeSession({ workItemId: "hw", plannedMinutes: 40, minutesSpent: 48 })
    );
    const [result] = calculateAccuracyByWorkType(sessions, [homework]);

    expect(result.workType).toBe("homework");
    expect(result.sessionCount).toBe(5);
    expect(result.percentDifference).toBe(20);
  });

  it("reports finishing early as a negative difference", () => {
    const sessions = Array.from({ length: 5 }, () =>
      makeSession({ workItemId: "rd", plannedMinutes: 40, minutesSpent: 30 })
    );
    expect(calculateAccuracyByWorkType(sessions, [reading])[0].percentDifference).toBe(-25);
  });

  it("orders categories by how far off they are, worst first", () => {
    const sessions = [
      ...Array.from({ length: 5 }, () => makeSession({ workItemId: "hw", plannedMinutes: 40, minutesSpent: 42 })),
      ...Array.from({ length: 5 }, () => makeSession({ workItemId: "rd", plannedMinutes: 40, minutesSpent: 64 })),
    ];
    const results = calculateAccuracyByWorkType(sessions, [homework, reading]);
    expect(results[0].workType).toBe("reading");
  });

  it("uses the median, so one outlier doesn't define a category", () => {
    const sessions = [
      ...Array.from({ length: 5 }, () => makeSession({ workItemId: "hw", plannedMinutes: 40, minutesSpent: 40 })),
      makeSession({ workItemId: "hw", plannedMinutes: 40, minutesSpent: 600 }),
    ];
    expect(calculateAccuracyByWorkType(sessions, [homework])[0].percentDifference).toBe(0);
  });

  it("attributes a decomposed item's stage sessions to the parent's work type", () => {
    const project = { id: "p1", workType: "project" as const };
    const stages = [{ id: "st1", workItemId: "p1" }];
    const sessions = Array.from({ length: 5 }, () =>
      makeSession({ workItemId: "st1", plannedMinutes: 40, minutesSpent: 50 })
    );
    expect(calculateAccuracyByWorkType(sessions, [project], stages)[0].workType).toBe("project");
  });
});

describe("calculateTypicalWorkWindow", () => {
  it("returns null below the minimum session threshold", () => {
    const sessions = Array.from({ length: MIN_SESSIONS_FOR_HABIT_INSIGHT - 1 }, () => makeSession());
    expect(calculateTypicalWorkWindow(sessions)).toBeNull();
  });

  it("finds the 2-hour window most sessions started in", () => {
    const sessions = [
      makeSession({ start: "2026-08-24T16:10" }),
      makeSession({ start: "2026-08-25T16:40" }),
      makeSession({ start: "2026-08-26T17:05" }),
      makeSession({ start: "2026-08-27T17:50" }),
      makeSession({ start: "2026-08-28T09:00" }), // an outlier
    ];
    const result = calculateTypicalWorkWindow(sessions);
    expect(result).not.toBeNull();
    expect(result!.startHour).toBe(16);
    expect(result!.endHour).toBe(18);
  });
});

describe("calculatePostponementRate", () => {
  it("returns null with no sessions", () => {
    expect(calculatePostponementRate([])).toBeNull();
  });

  it("computes the percentage postponed", () => {
    const sessions = [makeSession({ postponed: true }), makeSession(), makeSession(), makeSession()];
    expect(calculatePostponementRate(sessions)!.ratePercent).toBe(25);
  });
});

describe("calculateBusiestDayOfWeek", () => {
  it("returns null below the minimum threshold", () => {
    expect(calculateBusiestDayOfWeek([makeSession()])).toBeNull();
  });

  it("finds the day of week with the most completed sessions", () => {
    // 2026-08-24 is a Monday
    const sessions = [
      makeSession({ start: "2026-08-24T16:00" }),
      makeSession({ start: "2026-08-24T17:00" }),
      makeSession({ start: "2026-08-24T18:00" }),
      makeSession({ start: "2026-08-25T16:00" }),
      makeSession({ start: "2026-08-26T16:00" }),
    ];
    expect(calculateBusiestDayOfWeek(sessions)!.dayOfWeek).toBe(1); // Monday
  });
});

describe("calculateAverageWeeklyWorkloadMinutes", () => {
  it("returns null below the minimum threshold", () => {
    expect(calculateAverageWeeklyWorkloadMinutes([makeSession(), makeSession()])).toBeNull();
  });

  it("averages minutes per week across the span of sessions", () => {
    const sessions = [
      makeSession({ start: "2026-08-24T16:00", minutesSpent: 70 }),
      makeSession({ start: "2026-08-25T16:00", minutesSpent: 70 }),
      makeSession({ start: "2026-08-31T16:00", minutesSpent: 70 }), // exactly one week later
    ];
    // span = 8 days -> ~1.14 weeks; total 210 minutes -> ~184 min/week
    const result = calculateAverageWeeklyWorkloadMinutes(sessions);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(150);
    expect(result!).toBeLessThan(220);
  });
});

describe("calculateFeedbackTally", () => {
  it("returns null with no feedback", () => {
    expect(calculateFeedbackTally([])).toBeNull();
  });

  it("tallies each workload feeling", () => {
    const feedback: ScheduleFeedback[] = [
      { id: "1", userId: "u1", dateRange: { start: "a", end: "b" }, workloadFeeling: "too-heavy", createdAt: "x" },
      { id: "2", userId: "u1", dateRange: { start: "a", end: "b" }, workloadFeeling: "too-heavy", createdAt: "x" },
      { id: "3", userId: "u1", dateRange: { start: "a", end: "b" }, workloadFeeling: "just-right", createdAt: "x" },
    ];
    const tally = calculateFeedbackTally(feedback)!;
    expect(tally.tooHeavy).toBe(2);
    expect(tally.justRight).toBe(1);
    expect(tally.tooLight).toBe(0);
    expect(tally.total).toBe(3);
  });
});

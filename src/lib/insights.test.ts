import { describe, expect, it } from "vitest";
import {
  calculateAverageWeeklyWorkloadMinutes,
  calculateBusiestDayOfWeek,
  calculateEstimateAccuracy,
  calculateFeedbackTally,
  calculatePostponementRate,
  calculateTypicalWorkWindow,
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

  it("ignores sessions without both an estimate and an actual", () => {
    const sessions = [makeSession({ plannedMinutes: 30, minutesSpent: 40 }), makeSession({ postponed: true, minutesSpent: undefined })];
    expect(calculateEstimateAccuracy(sessions)!.sessionCount).toBe(1);
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

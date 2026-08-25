import { describe, expect, it } from "vitest";
import { calculateDailyCapacity, calculateFeedbackAdjustment } from "../capacity";
import { MAX_DAILY_CAPACITY_MINUTES } from "../constants";
import { makeFeedback, makePlanningProfile } from "./fixtures";

describe("calculateDailyCapacity", () => {
  it("gives higher-rigor courses a larger capacity target than grade-level, all else equal", () => {
    const profile = makePlanningProfile();
    const gradeLevel = calculateDailyCapacity(profile, { relevantRigors: ["grade_level"], isBehind: false });
    const ap = calculateDailyCapacity(profile, { relevantRigors: ["ap"], isBehind: false });
    expect(ap).toBeGreaterThan(gradeLevel);
  });

  it("does not change capacity when there is no rigor data at all (no invented workload)", () => {
    const profile = makePlanningProfile();
    const none = calculateDailyCapacity(profile, { relevantRigors: [], isBehind: false });
    const gradeLevel = calculateDailyCapacity(profile, { relevantRigors: ["grade_level"], isBehind: false });
    expect(none).toBe(gradeLevel); // grade_level multiplier is 1, same as "no data"
  });

  it("raises capacity when the student is behind, but never past the tolerance ceiling", () => {
    const profile = makePlanningProfile({ workloadTolerance: "moderate" });
    const behind = calculateDailyCapacity(profile, { relevantRigors: [], isBehind: true });
    const notBehind = calculateDailyCapacity(profile, { relevantRigors: [], isBehind: false });
    expect(behind).toBeGreaterThan(notBehind);
    expect(behind).toBeLessThanOrEqual(MAX_DAILY_CAPACITY_MINUTES.moderate);
  });
});

describe("calculateFeedbackAdjustment", () => {
  it("returns no adjustment with fewer than two feedback entries", () => {
    expect(calculateFeedbackAdjustment([])).toBe(1);
    expect(calculateFeedbackAdjustment([makeFeedback("too-heavy", "2026-08-20T00:00:00.000Z")])).toBe(1);
  });

  it("decreases the multiplier after two consecutive 'too-heavy' responses", () => {
    const history = [
      makeFeedback("too-heavy", "2026-08-17T00:00:00.000Z"),
      makeFeedback("too-heavy", "2026-08-24T00:00:00.000Z"),
    ];
    expect(calculateFeedbackAdjustment(history)).toBeLessThan(1);
  });

  it("increases the multiplier after two consecutive 'too-light' responses", () => {
    const history = [
      makeFeedback("too-light", "2026-08-17T00:00:00.000Z"),
      makeFeedback("too-light", "2026-08-24T00:00:00.000Z"),
    ];
    expect(calculateFeedbackAdjustment(history)).toBeGreaterThan(1);
  });

  it("resets to neutral when the most recent feedback breaks the streak", () => {
    const history = [
      makeFeedback("too-heavy", "2026-08-10T00:00:00.000Z"),
      makeFeedback("too-heavy", "2026-08-17T00:00:00.000Z"),
      makeFeedback("just-right", "2026-08-24T00:00:00.000Z"),
    ];
    expect(calculateFeedbackAdjustment(history)).toBe(1);
  });

  it("only looks at the most recent entries, not the oldest ones", () => {
    const history = [
      makeFeedback("too-light", "2026-08-01T00:00:00.000Z"),
      makeFeedback("too-heavy", "2026-08-17T00:00:00.000Z"),
      makeFeedback("too-heavy", "2026-08-24T00:00:00.000Z"),
    ];
    expect(calculateFeedbackAdjustment(history)).toBeLessThan(1);
  });

  it("never pushes calculateDailyCapacity past the tolerance ceiling even after a 'too-light' streak", () => {
    const profile = makePlanningProfile({ workloadTolerance: "moderate", freeTimePriority: "low" });
    const history = [
      makeFeedback("too-light", "2026-08-17T00:00:00.000Z"),
      makeFeedback("too-light", "2026-08-24T00:00:00.000Z"),
    ];
    const capacity = calculateDailyCapacity(profile, {
      relevantRigors: ["ap"],
      isBehind: true,
      feedbackAdjustment: calculateFeedbackAdjustment(history),
    });
    expect(capacity).toBeLessThanOrEqual(MAX_DAILY_CAPACITY_MINUTES.moderate);
  });
});

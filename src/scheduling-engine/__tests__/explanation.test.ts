import { describe, expect, it } from "vitest";
import { explainScheduleDecision } from "../explanation";
import { calculatePriority } from "../priority";
import { makeTest, NOW } from "./fixtures";

describe("explainScheduleDecision", () => {
  it("includes importance, deadline strictness, remaining time, and session count as real bullets", () => {
    const item = makeTest({ weight: "high", deadlineStrictness: "hard", estimatedMinutes: 120 });
    const breakdown = calculatePriority(item, { now: NOW, remainingMinutes: 90 });
    const explanation = explainScheduleDecision(item, breakdown, { remainingMinutes: 90, sessionCount: 2, isBehind: false });

    expect(explanation.workItemId).toBe(item.id);
    expect(explanation.bullets).toContain("High importance");
    expect(explanation.bullets).toContain("Hard deadline");
    expect(explanation.bullets.some((b) => b.includes("1h 30m"))).toBe(true);
    expect(explanation.bullets).toContain("2 sessions planned before the deadline");
  });

  it("explains being behind honestly rather than a generic phrase", () => {
    const item = makeTest();
    const breakdown = calculatePriority(item, { now: NOW, remainingMinutes: 30 });
    const explanation = explainScheduleDecision(item, breakdown, { remainingMinutes: 30, sessionCount: 1, isBehind: true });
    expect(explanation.bullets.some((b) => b.includes("behind"))).toBe(true);
  });

  it("omits the remaining-time bullet when nothing is left (fully covered by a manual override)", () => {
    const item = makeTest();
    const breakdown = calculatePriority(item, { now: NOW, remainingMinutes: 0 });
    const explanation = explainScheduleDecision(item, breakdown, { remainingMinutes: 0, sessionCount: 1, isBehind: false });
    expect(explanation.bullets.some((b) => b.includes("remaining"))).toBe(false);
  });

  it("reuses explainPriority's sentence as the primary reason, not a duplicate implementation", () => {
    const item = makeTest();
    const breakdown = calculatePriority(item, { now: NOW, remainingMinutes: 60 });
    const explanation = explainScheduleDecision(item, breakdown, { remainingMinutes: 60, sessionCount: 1, isBehind: false });
    expect(explanation.primaryReason).toContain(item.title);
    expect(explanation.primaryReason).toMatch(/priority \d\.\d\d/);
  });
});

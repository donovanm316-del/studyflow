import { describe, expect, it } from "vitest";
import { calculatePriority, calculateUrgency, explainPriority, isOverdue } from "../priority";
import { makeAssignment, makeTest, NOW } from "./fixtures";

describe("calculatePriority", () => {
  it("scores high weight above low weight when other factors match", () => {
    const low = makeAssignment({ weight: "low", dueDate: "2026-08-27T23:59:00" });
    const high = makeAssignment({ weight: "high", dueDate: "2026-08-27T23:59:00" });

    const lowScore = calculatePriority(low, { now: NOW, remainingMinutes: 60 }).score;
    const highScore = calculatePriority(high, { now: NOW, remainingMinutes: 60 }).score;

    expect(highScore).toBeGreaterThan(lowScore);
  });

  it("gives a sooner deadline higher urgency than a later one", () => {
    const soon = calculateUrgency("2026-08-25T23:59:00", NOW);
    const later = calculateUrgency("2026-09-10T23:59:00", NOW);
    expect(soon).toBeGreaterThan(later);
  });

  it("scores a hard deadline above a flexible one when everything else matches", () => {
    const hard = makeAssignment({ deadlineStrictness: "hard", dueDate: "2026-08-27T23:59:00" });
    const flexible = makeAssignment({ deadlineStrictness: "flexible", dueDate: "2026-08-27T23:59:00" });

    const hardScore = calculatePriority(hard, { now: NOW, remainingMinutes: 60 }).score;
    const flexibleScore = calculatePriority(flexible, { now: NOW, remainingMinutes: 60 }).score;

    expect(hardScore).toBeGreaterThan(flexibleScore);
  });

  it("gives overdue work a strong priority boost", () => {
    const overdue = makeAssignment({ dueDate: "2026-08-20T23:59:00" }); // before NOW
    const notOverdue = makeAssignment({ dueDate: "2026-08-27T23:59:00" });

    expect(isOverdue(overdue.dueDate, NOW)).toBe(true);
    const overdueScore = calculatePriority(overdue, { now: NOW, remainingMinutes: 60 }).score;
    const upcomingScore = calculatePriority(notOverdue, { now: NOW, remainingMinutes: 60 }).score;
    expect(overdueScore).toBeGreaterThan(upcomingScore);
  });

  it("weighs heavier remaining workload above a lighter one, other factors equal", () => {
    const item = makeAssignment({ dueDate: "2026-08-27T23:59:00" });
    const light = calculatePriority(item, { now: NOW, remainingMinutes: 20 }).score;
    const heavy = calculatePriority(item, { now: NOW, remainingMinutes: 170 }).score;
    expect(heavy).toBeGreaterThan(light);
  });

  it("does not let a low-weight assignment due slightly sooner beat a high-weight one due slightly later", () => {
    // The scenario from the spec: today is Sunday, low-weight 30-minute item due Tuesday
    // shouldn't outrank a high-weight 2-hour item due Wednesday.
    const lowWeightSoon = makeAssignment({
      title: "Low weight, due Tuesday",
      weight: "low",
      dueDate: "2026-08-25T23:59:00",
      estimatedMinutes: 30,
    });
    const highWeightLater = makeAssignment({
      title: "High weight, due Wednesday",
      weight: "high",
      dueDate: "2026-08-26T23:59:00",
      estimatedMinutes: 120,
    });

    const a = calculatePriority(lowWeightSoon, { now: NOW, remainingMinutes: 30 }).score;
    const b = calculatePriority(highWeightLater, { now: NOW, remainingMinutes: 120 }).score;
    expect(b).toBeGreaterThan(a);
  });
});

describe("explainPriority", () => {
  it("explains the score using the item's actual weight, strictness, and estimate", () => {
    const item = makeTest({ title: "Biology Test", weight: "high", deadlineStrictness: "hard", estimatedMinutes: 150 });
    const breakdown = calculatePriority(item, { now: NOW, remainingMinutes: 150 });
    const explanation = explainPriority(item, breakdown);

    expect(explanation).toContain("Biology Test");
    expect(explanation).toContain("high-weight");
    expect(explanation).toContain("hard deadline");
    expect(explanation).toContain("2.5 hours");
  });
});

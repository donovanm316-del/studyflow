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

describe("calculateUrgency — time awareness (Phase 4.5A)", () => {
  const SUNDAY_6PM = "2026-08-23T18:00";

  it("treats due-tonight as meaningfully more urgent than due-tomorrow-night", () => {
    // The spec's worked example: ~6 hours left vs ~30 hours left must not read as equally urgent.
    const tonight = calculateUrgency("2026-08-23T23:59", SUNDAY_6PM);
    const tomorrow = calculateUrgency("2026-08-24T23:59", SUNDAY_6PM);

    expect(tonight).toBeGreaterThan(tomorrow);
    // A real separation, not a rounding difference — the old linear curve gave only ~0.10 here.
    expect(tonight - tomorrow).toBeGreaterThan(0.2);
  });

  it("distinguishes different times on the same calendar day", () => {
    const morning = calculateUrgency("2026-08-24T09:00", SUNDAY_6PM);
    const evening = calculateUrgency("2026-08-24T21:00", SUNDAY_6PM);
    expect(morning).toBeGreaterThan(evening);
  });

  it("returns maximum urgency for an already-passed deadline", () => {
    expect(calculateUrgency("2026-08-23T17:00", SUNDAY_6PM)).toBe(1);
  });

  it("treats a deadline later today as overdue only once its time has actually passed", () => {
    expect(isOverdue("2026-08-23T23:59", SUNDAY_6PM)).toBe(false);
    expect(isOverdue("2026-08-23T17:59", SUNDAY_6PM)).toBe(true);
  });

  it("decays monotonically as the deadline moves further out", () => {
    const points = ["2026-08-23T23:59", "2026-08-24T23:59", "2026-08-26T23:59", "2026-09-02T23:59"].map((d) =>
      calculateUrgency(d, SUNDAY_6PM)
    );
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).toBeLessThan(points[i - 1]);
    }
  });

  it("reads a legacy date-only deadline as end-of-day, not midnight", () => {
    expect(calculateUrgency("2026-08-24", SUNDAY_6PM)).toBe(calculateUrgency("2026-08-24T23:59", SUNDAY_6PM));
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

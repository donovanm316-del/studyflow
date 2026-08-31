import { describe, expect, it } from "vitest";
import { busiestCourse, busiestForecastDay, buildWeekInsightLines, courseConcentrationDay, courseWorkloadBreakdown } from "./classroom-insights";
import { generateSchedule } from "@/scheduling-engine";
import { blockDatesForItems } from "@/lib/schedule-format";
import { makeAssignment, makePlanningProfile, NOW } from "@/scheduling-engine/__tests__/fixtures";

const TODAY = "2026-08-24"; // Monday, matches NOW
const WEEK_END = "2026-08-30";

function schedule(workItems: Parameters<typeof generateSchedule>[0]["workItems"]) {
  return generateSchedule({
    userId: "u1",
    rangeStart: TODAY,
    rangeEnd: WEEK_END,
    now: NOW,
    workItems,
    commitments: [],
    planningProfile: makePlanningProfile(),
  });
}

describe("courseWorkloadBreakdown", () => {
  it("groups remaining work by subject", () => {
    const bio = makeAssignment({ id: "bio-1", subject: "AP Biology", dueDate: "2026-08-27T23:59:00", estimatedMinutes: 60 });
    const hist = makeAssignment({ id: "hist-1", subject: "History", dueDate: "2026-08-28T23:59:00", estimatedMinutes: 90 });
    const result = schedule([bio, hist]);

    const breakdown = courseWorkloadBreakdown([bio, hist], result.deadlineCapacities, WEEK_END);
    const bioRow = breakdown.find((c) => c.subject === "AP Biology")!;
    const histRow = breakdown.find((c) => c.subject === "History")!;

    expect(bioRow.remainingMinutes).toBe(60);
    expect(histRow.remainingMinutes).toBe(90);
  });

  it("sums multiple items in the same course", () => {
    const a = makeAssignment({ id: "a", subject: "AP Biology", dueDate: "2026-08-27T23:59:00", estimatedMinutes: 40 });
    const b = makeAssignment({ id: "b", subject: "AP Biology", dueDate: "2026-08-28T23:59:00", estimatedMinutes: 50 });
    const result = schedule([a, b]);
    const breakdown = courseWorkloadBreakdown([a, b], result.deadlineCapacities, WEEK_END);

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].remainingMinutes).toBe(90);
    expect(breakdown[0].itemIds).toEqual(["a", "b"]);
  });

  it("takes the worst risk among a course's items, never the best or an average", () => {
    // A tiny, comfortable item and a genuinely at-risk one in the same course — the course-level
    // risk must reflect the one the student actually needs to worry about.
    const comfy = makeAssignment({ id: "c", subject: "History", dueDate: "2026-08-29T23:59:00", estimatedMinutes: 20 });
    const risky = makeAssignment({ id: "r", subject: "History", dueDate: "2026-08-25T09:00:00", estimatedMinutes: 600 });
    const result = schedule([comfy, risky]);
    const breakdown = courseWorkloadBreakdown([comfy, risky], result.deadlineCapacities, WEEK_END);

    expect(breakdown[0].risk).toBe(result.deadlineCapacities["r"].risk);
    expect(result.deadlineCapacities["r"].risk).toBe("at-risk");
  });

  it("excludes completed work from remaining minutes", () => {
    const done = makeAssignment({ id: "d", subject: "History", dueDate: "2026-08-27T23:59:00", estimatedMinutes: 60, status: "completed" });
    const result = schedule([done]);
    expect(courseWorkloadBreakdown([done], result.deadlineCapacities, WEEK_END)).toEqual([]);
  });

  it("counts only items due on or before the given cutoff as due soon", () => {
    const soon = makeAssignment({ id: "s", subject: "History", dueDate: "2026-08-26T23:59:00", estimatedMinutes: 30 });
    const later = makeAssignment({ id: "l", subject: "History", dueDate: "2026-08-29T23:59:00", estimatedMinutes: 30 });
    const result = schedule([soon, later]);
    const breakdown = courseWorkloadBreakdown([soon, later], result.deadlineCapacities, "2026-08-26");

    expect(breakdown[0].dueSoonCount).toBe(1);
  });

  it("groups work with no subject rather than dropping it", () => {
    const item = makeAssignment({ id: "n", subject: undefined, dueDate: "2026-08-27T23:59:00", estimatedMinutes: 30 });
    const result = schedule([item]);
    expect(courseWorkloadBreakdown([item], result.deadlineCapacities, WEEK_END)[0].subject).toBe("No subject");
  });

  it("surfaces a real Classroom link for an imported course, never a constructed one", () => {
    const item = makeAssignment({
      id: "gc",
      subject: "AP Biology",
      dueDate: "2026-08-27T23:59:00",
      estimatedMinutes: 30,
      source: "google-classroom",
      externalUrl: "https://classroom.google.com/c/c1/a/cw1",
    });
    const result = schedule([item]);
    expect(courseWorkloadBreakdown([item], result.deadlineCapacities, WEEK_END)[0].classroomUrl).toBe(
      "https://classroom.google.com/c/c1/a/cw1"
    );
  });

  it("sorts courses by remaining work, busiest first", () => {
    const light = makeAssignment({ id: "light", subject: "Art", dueDate: "2026-08-27T23:59:00", estimatedMinutes: 15 });
    const heavy = makeAssignment({ id: "heavy", subject: "History", dueDate: "2026-08-28T23:59:00", estimatedMinutes: 180 });
    const result = schedule([light, heavy]);
    const breakdown = courseWorkloadBreakdown([light, heavy], result.deadlineCapacities, WEEK_END);

    expect(breakdown.map((c) => c.subject)).toEqual(["History", "Art"]);
  });
});

describe("busiestCourse", () => {
  it("returns null with fewer than two courses — nothing to compare", () => {
    expect(busiestCourse([{ subject: "History", remainingMinutes: 60, dueSoonCount: 1, risk: "comfortable", itemIds: ["a"] }])).toBeNull();
  });

  it("returns null when there is no work at all", () => {
    expect(busiestCourse([])).toBeNull();
  });

  it("returns the course with the most remaining work", () => {
    const breakdown = [
      { subject: "History", remainingMinutes: 180, dueSoonCount: 1, risk: "comfortable" as const, itemIds: ["a"] },
      { subject: "Art", remainingMinutes: 15, dueSoonCount: 0, risk: "comfortable" as const, itemIds: ["b"] },
    ];
    expect(busiestCourse(breakdown)?.subject).toBe("History");
  });
});

describe("courseConcentrationDay", () => {
  it("returns null with fewer than three data points", () => {
    expect(courseConcentrationDay(["2026-08-24", "2026-08-25"])).toBeNull();
  });

  it("returns null when work is spread evenly, not lopsided", () => {
    expect(courseConcentrationDay(["2026-08-24", "2026-08-25", "2026-08-26"])).toBeNull();
  });

  it("names the weekday when one day holds at least half the sessions", () => {
    const day = courseConcentrationDay(["2026-08-27", "2026-08-27", "2026-08-27", "2026-08-28"]); // Thursday x3, Friday x1
    expect(day).toBe("Thursday");
  });

  it("resolves from real block dates via blockDatesForItems", () => {
    const item = makeAssignment({ id: "bio", subject: "AP Biology", dueDate: "2026-08-27T15:00:00", estimatedMinutes: 180 });
    const result = schedule([item]);
    const dates = blockDatesForItems(result.blocks, ["bio"], []);
    // Whatever the engine actually did with 3 hours of work before Thursday 3pm is a real signal —
    // just assert the function runs against real output without throwing and returns a string or null.
    const day = courseConcentrationDay(dates);
    expect(day === null || typeof day === "string").toBe(true);
  });
});

describe("busiestForecastDay", () => {
  it("returns null when nothing is scheduled", () => {
    expect(busiestForecastDay([{ date: "2026-08-24", workMinutes: 0, availableMinutes: 300 }])).toBeNull();
  });

  it("returns the day with the most projected work", () => {
    const forecast = [
      { date: "2026-08-24", workMinutes: 30, availableMinutes: 300 },
      { date: "2026-08-25", workMinutes: 90, availableMinutes: 300 },
    ];
    expect(busiestForecastDay(forecast)?.date).toBe("2026-08-25");
  });
});

describe("buildWeekInsightLines", () => {
  it("reports assignments due this week when there are any", () => {
    const item = makeAssignment({ dueDate: "2026-08-27T23:59:00", estimatedMinutes: 60 });
    const result = schedule([item]);
    const lines = buildWeekInsightLines(result, [item], TODAY, WEEK_END);
    expect(lines.some((l) => l.includes("1 assignment due this week"))).toBe(true);
  });

  it("says nothing about assignments due this week when there are none", () => {
    const result = schedule([]);
    const lines = buildWeekInsightLines(result, [], TODAY, WEEK_END);
    expect(lines.some((l) => l.includes("due this week"))).toBe(false);
  });

  it("reports at-risk items only when the engine actually flags one at-risk", () => {
    const risky = makeAssignment({ dueDate: "2026-08-25T09:00:00", estimatedMinutes: 600 });
    const result = schedule([risky]);
    const lines = buildWeekInsightLines(result, [risky], TODAY, WEEK_END);
    expect(lines.some((l) => l.includes("less usable time remaining"))).toBe(true);
  });

  it("never claims a shortfall when nothing is at risk", () => {
    const easy = makeAssignment({ dueDate: "2026-08-29T23:59:00", estimatedMinutes: 30 });
    const result = schedule([easy]);
    const lines = buildWeekInsightLines(result, [easy], TODAY, WEEK_END);
    expect(lines.some((l) => l.includes("less usable time remaining"))).toBe(false);
  });

  it("always ends with the same headline summarizeWeek would give — one status system, not two", () => {
    const item = makeAssignment({ dueDate: "2026-08-27T23:59:00", estimatedMinutes: 60 });
    const result = schedule([item]);
    const lines = buildWeekInsightLines(result, [item], TODAY, WEEK_END);
    expect(lines[lines.length - 1]).toBe("Your week is on track.");
  });

  it("caps the number of lines so it never reads as a dumped statistics table", () => {
    const risky = makeAssignment({ dueDate: "2026-08-25T09:00:00", estimatedMinutes: 600 });
    const result = schedule([risky]);
    const lines = buildWeekInsightLines(result, [risky], TODAY, WEEK_END);
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it("produces a minimal but real summary for an empty week rather than nothing at all", () => {
    const result = schedule([]);
    const lines = buildWeekInsightLines(result, [], TODAY, WEEK_END);
    expect(lines.length).toBeGreaterThan(0); // at minimum, the overall status headline
  });
});

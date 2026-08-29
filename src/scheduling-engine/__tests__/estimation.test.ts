import { describe, expect, it } from "vitest";
import { buildEstimateHistory, personalizeEstimate } from "../estimation";
import { refineEstimate } from "../index";
import { ESTIMATE_MAX_RATIO, ESTIMATE_MIN_SAMPLES } from "../constants";
import { makeAssignment, makeProject } from "./fixtures";
import type { WorkSession, WorkStage } from "@/types/models";
import type { SchedulableWorkItem } from "../types";

let sessionCounter = 0;
/** A completed session for `item`, with `planned` estimated and `actual` genuinely spent. */
function session(workItemId: string, planned: number, actual: number, at = "2026-08-20T16:00"): WorkSession {
  sessionCounter += 1;
  return {
    id: `s${sessionCounter}`,
    userId: "u1",
    workItemId,
    start: at,
    end: at,
    plannedMinutes: planned,
    minutesSpent: actual,
  };
}

/** `count` sessions where the student took `ratio`x their estimate. */
function repeated(item: SchedulableWorkItem, count: number, ratio: number, startDay = 10): WorkSession[] {
  return Array.from({ length: count }, (_, i) =>
    session(item.id, 40, Math.round(40 * ratio), `2026-08-${String(startDay + i).padStart(2, "0")}T16:00`)
  );
}

describe("insufficient data", () => {
  it("does not adjust with no history at all", () => {
    const item = makeAssignment({ estimatedMinutes: 45 });
    const adjustment = personalizeEstimate(item, buildEstimateHistory([], [item]));

    expect(adjustment.adjusted).toBe(false);
    expect(adjustment.planningMinutes).toBe(45);
    expect(adjustment.confidence).toBe("insufficient");
    expect(adjustment.reason).toBe("");
  });

  it("does not adjust below the minimum sample size", () => {
    const item = makeAssignment({ estimatedMinutes: 45 });
    const sessions = repeated(item, ESTIMATE_MIN_SAMPLES - 1, 1.5);
    const adjustment = personalizeEstimate(item, buildEstimateHistory(sessions, [item]));

    expect(adjustment.adjusted).toBe(false);
    expect(adjustment.planningMinutes).toBe(45);
  });

  it("ignores postponed sessions, which record no actual time", () => {
    const item = makeAssignment({ estimatedMinutes: 45 });
    const postponed: WorkSession[] = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`,
      userId: "u1",
      workItemId: item.id,
      start: "2026-08-20T16:00",
      plannedMinutes: 40,
      postponed: true,
    }));
    const adjustment = personalizeEstimate(item, buildEstimateHistory(postponed, [item]));
    expect(adjustment.adjusted).toBe(false);
  });
});

describe("sufficient data", () => {
  it("adjusts upward for a student who consistently runs long", () => {
    const item = makeAssignment({ estimatedMinutes: 45 });
    const sessions = repeated(item, 6, 1.4);
    const adjustment = personalizeEstimate(item, buildEstimateHistory(sessions, [item]));

    expect(adjustment.adjusted).toBe(true);
    expect(adjustment.planningMinutes).toBeGreaterThan(45);
    expect(adjustment.studentMinutes).toBe(45); // the student's own number is never overwritten
    expect(adjustment.reason).toMatch(/longer than your estimates/);
  });

  it("adjusts downward for a student who consistently finishes early", () => {
    const item = makeAssignment({ estimatedMinutes: 60 });
    const sessions = repeated(item, 8, 0.7);
    const adjustment = personalizeEstimate(item, buildEstimateHistory(sessions, [item]));

    expect(adjustment.planningMinutes).toBeLessThan(60);
    expect(adjustment.reason).toMatch(/shorter than your estimates/);
  });

  it("reports a range from the student's own spread, not invented precision", () => {
    const item = makeAssignment({ estimatedMinutes: 60 });
    const sessions = [
      ...repeated(item, 4, 1.2),
      ...repeated(item, 4, 1.5, 20),
    ];
    const adjustment = personalizeEstimate(item, buildEstimateHistory(sessions, [item]));

    expect(adjustment.rangeLowMinutes).toBeLessThanOrEqual(adjustment.planningMinutes);
    expect(adjustment.rangeHighMinutes).toBeGreaterThanOrEqual(adjustment.planningMinutes);
  });

  it("does not announce an adjustment too small to matter", () => {
    const item = makeAssignment({ estimatedMinutes: 45 });
    const sessions = repeated(item, 6, 1.02); // ~2% — noise, not a pattern
    const adjustment = personalizeEstimate(item, buildEstimateHistory(sessions, [item]));

    expect(adjustment.adjusted).toBe(false);
    expect(adjustment.reason).toBe("");
  });
});

describe("confidence", () => {
  it("escalates with sample size", () => {
    const item = makeAssignment({ estimatedMinutes: 45 });
    const at = (n: number) => personalizeEstimate(item, buildEstimateHistory(repeated(item, n, 1.4), [item])).confidence;

    expect(at(2)).toBe("insufficient");
    expect(at(4)).toBe("limited");
    expect(at(9)).toBe("good");
    expect(at(12)).toBe("good");
  });

  it("moves a thin history less far than a thick one", () => {
    const item = makeAssignment({ estimatedMinutes: 60 });
    const thin = personalizeEstimate(item, buildEstimateHistory(repeated(item, 3, 1.4), [item]));
    const thick = personalizeEstimate(item, buildEstimateHistory(repeated(item, 10, 1.4), [item]));

    expect(thin.planningMinutes).toBeLessThan(thick.planningMinutes);
    expect(thin.appliedRatio).toBeLessThan(thick.appliedRatio);
  });

  it("describes what the history actually shows, not the damped figure it plans with", () => {
    // The planner is deliberately conservative, so the applied ratio is smaller than the observed
    // one. The sentence must report the observed 40% — claiming the damped number would both
    // misstate the student's own record and contradict the Insights page.
    const item = makeAssignment({ estimatedMinutes: 60 });
    const adjustment = personalizeEstimate(item, buildEstimateHistory(repeated(item, 8, 1.4), [item]));

    expect(adjustment.reason).toContain("40%");
    expect(adjustment.appliedRatio).toBeLessThan(1.4);
    expect(adjustment.planningMinutes).toBeLessThan(60 * 1.4);
  });

  it("reports the real sample count it used", () => {
    const item = makeAssignment({ estimatedMinutes: 45 });
    const adjustment = personalizeEstimate(item, buildEstimateHistory(repeated(item, 6, 1.3), [item]));
    expect(adjustment.sampleSize).toBe(6);
    expect(adjustment.reason).toContain("6 recorded sessions");
  });
});

describe("similarity matching and fallback", () => {
  it("prefers same work type + rigor + subject when that history is deep enough", () => {
    const target = makeAssignment({ workType: "essay", rigor: "ap", subject: "English", estimatedMinutes: 60 });
    const sameCourse = makeAssignment({ workType: "essay", rigor: "ap", subject: "English" });
    const otherCourse = makeAssignment({ workType: "essay", rigor: "ap", subject: "History" });

    const history = buildEstimateHistory(
      [...repeated(sameCourse, 4, 1.5), ...repeated(otherCourse, 8, 0.8, 20)],
      [target, sameCourse, otherCourse]
    );
    const adjustment = personalizeEstimate(target, history);

    expect(adjustment.matchLevel).toBe("type-rigor-subject");
    expect(adjustment.planningMinutes).toBeGreaterThan(60); // driven by the same-course history
  });

  it("falls back to broader history when the specific category is too thin", () => {
    const target = makeAssignment({ workType: "reading", rigor: "honors", subject: "Biology", estimatedMinutes: 40 });
    const sameType = makeAssignment({ workType: "reading", rigor: "ap", subject: "Chemistry" });

    const history = buildEstimateHistory(repeated(sameType, 6, 1.4), [target, sameType]);
    const adjustment = personalizeEstimate(target, history);

    expect(adjustment.matchLevel).toBe("type");
    expect(adjustment.adjusted).toBe(true);
  });

  it("falls back to overall history when no same-type history exists", () => {
    const target = makeAssignment({ workType: "reading", estimatedMinutes: 40 });
    const different = makeAssignment({ workType: "homework" });

    const history = buildEstimateHistory(repeated(different, 6, 1.4), [target, different]);
    expect(personalizeEstimate(target, history).matchLevel).toBe("overall");
  });

  it("still counts sessions whose work item was deleted toward overall accuracy", () => {
    const target = makeAssignment({ estimatedMinutes: 40 });
    // No work item passed for "ghost" — the estimate/actual pair is still real data.
    const history = buildEstimateHistory(
      Array.from({ length: 6 }, (_, i) => session("ghost", 40, 56, `2026-08-1${i}T16:00`)),
      [target]
    );
    const adjustment = personalizeEstimate(target, history);
    expect(adjustment.matchLevel).toBe("overall");
    expect(adjustment.adjusted).toBe(true);
  });

  it("resolves a decomposed item's stage sessions back to the parent's category", () => {
    const project = makeProject({ workType: "project", rigor: "ap", subject: "History", estimatedMinutes: 300 });
    const stages: WorkStage[] = [
      { id: "st1", workItemId: project.id, title: "Research", stageType: "research", order: 0, estimatedMinutes: 60, status: "completed" },
    ];
    const sessions = Array.from({ length: 5 }, (_, i) => session("st1", 40, 60, `2026-08-1${i}T16:00`));
    const history = buildEstimateHistory(sessions, [project], stages);

    expect(personalizeEstimate(project, history).matchLevel).toBe("type-rigor-subject");
  });
});

describe("outlier and bound safety", () => {
  it("is not derailed by a single extreme session", () => {
    const item = makeAssignment({ estimatedMinutes: 60 });
    const steady = repeated(item, 7, 1.0);
    const outlier = session(item.id, 40, 400, "2026-08-25T16:00"); // one 10x night

    const withOutlier = personalizeEstimate(item, buildEstimateHistory([...steady, outlier], [item]));
    expect(withOutlier.adjusted).toBe(false); // median holds at ~1.0
  });

  it("never plans more than the maximum ratio, however extreme the history", () => {
    const item = makeAssignment({ estimatedMinutes: 60 });
    const sessions = repeated(item, 12, 5); // consistently 5x over
    const adjustment = personalizeEstimate(item, buildEstimateHistory(sessions, [item]));

    expect(adjustment.appliedRatio).toBeLessThanOrEqual(ESTIMATE_MAX_RATIO);
    expect(adjustment.planningMinutes).toBeLessThanOrEqual(60 * ESTIMATE_MAX_RATIO);
  });

  it("never plans below the minimum ratio", () => {
    const item = makeAssignment({ estimatedMinutes: 60 });
    const sessions = repeated(item, 12, 0.1);
    expect(personalizeEstimate(item, buildEstimateHistory(sessions, [item])).planningMinutes).toBeGreaterThanOrEqual(
      Math.round(60 * 0.8)
    );
  });
});

describe("recency — the student improves (Scenario I)", () => {
  it("lets recent accurate estimates outweigh older inaccurate ones", () => {
    const item = makeAssignment({ estimatedMinutes: 60 });
    // 12 old sessions badly underestimated, then 12 recent accurate ones.
    const old = Array.from({ length: 12 }, (_, i) => session(item.id, 40, 64, `2026-07-${String(1 + i).padStart(2, "0")}T16:00`));
    const recent = Array.from({ length: 12 }, (_, i) => session(item.id, 40, 40, `2026-08-${String(1 + i).padStart(2, "0")}T16:00`));

    const before = personalizeEstimate(item, buildEstimateHistory(old, [item]));
    const after = personalizeEstimate(item, buildEstimateHistory([...old, ...recent], [item]));

    expect(before.adjusted).toBe(true);
    expect(before.planningMinutes).toBeGreaterThan(60);
    // Old behavior no longer dominates once it falls outside the recent window.
    expect(after.planningMinutes).toBeLessThan(before.planningMinutes);
    expect(after.adjusted).toBe(false);
  });

  it("adjusts gradually as evidence accumulates (Scenario H)", () => {
    const item = makeAssignment({ estimatedMinutes: 60 });
    const growth = [3, 6, 10].map(
      (n) => personalizeEstimate(item, buildEstimateHistory(repeated(item, n, 1.35), [item])).planningMinutes
    );
    // Monotonically approaches the observed ratio rather than jumping there on sample three.
    expect(growth[0]).toBeLessThanOrEqual(growth[1]);
    expect(growth[1]).toBeLessThanOrEqual(growth[2]);
    expect(growth[0]).toBeGreaterThan(60);
  });
});

describe("refineEstimate", () => {
  it("returns the base estimate when there isn't enough history", () => {
    expect(refineEstimate(45, [{ workItemId: "a", estimatedMinutes: 40, actualMinutes: 60 }])).toBe(45);
  });

  it("raises the estimate for a student who runs long, within bounds", () => {
    const samples = Array.from({ length: 6 }, () => ({ workItemId: "a", estimatedMinutes: 40, actualMinutes: 60 }));
    const refined = refineEstimate(60, samples);
    expect(refined).toBeGreaterThan(60);
    expect(refined).toBeLessThanOrEqual(60 * ESTIMATE_MAX_RATIO);
  });

  it("ignores unusable samples rather than dividing by zero", () => {
    const samples = Array.from({ length: 6 }, () => ({ workItemId: "a", estimatedMinutes: 0, actualMinutes: 60 }));
    expect(refineEstimate(45, samples)).toBe(45);
  });
});

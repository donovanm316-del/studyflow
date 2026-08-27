import { describe, expect, it } from "vitest";
import {
  isDecomposable,
  isStageEligible,
  nextEligibleStage,
  renumberStages,
  stageProgress,
  suggestStages,
  totalRemainingStageMinutes,
} from "../decomposition";
import { makeAssignment, makeProject, makeTest } from "./fixtures";
import type { WorkStage } from "@/types/models";

describe("isDecomposable / suggestStages", () => {
  it("keeps simple homework as one task, no matter the estimate", () => {
    const item = makeAssignment({ workType: "homework", estimatedMinutes: 25 });
    expect(isDecomposable(item)).toBe(false);
    expect(suggestStages(item)).toBeNull();
  });

  it("does not decompose a long reading either — workType, not just duration, gates eligibility", () => {
    const item = makeAssignment({ workType: "reading", estimatedMinutes: 400 });
    expect(suggestStages(item)).toBeNull();
  });

  it("does not decompose a project under its minimum duration", () => {
    const item = makeProject({ workType: "project", estimatedMinutes: 60 });
    expect(suggestStages(item)).toBeNull();
  });

  it("decomposes a large project into research/outline/draft/revise/finalize", () => {
    const item = makeProject({ workType: "project", estimatedMinutes: 180 });
    const stages = suggestStages(item);
    expect(stages).not.toBeNull();
    expect(stages!.map((s) => s.stageType)).toEqual(["research", "outline", "draft", "revise", "finalize"]);
  });

  it("decomposes a large essay, including an understand-prompt stage", () => {
    const item = makeAssignment({ workType: "essay", estimatedMinutes: 180 });
    const stages = suggestStages(item);
    expect(stages).not.toBeNull();
    expect(stages![0].stageType).toBe("understand-prompt");
    expect(stages!.map((s) => s.stageType)).toContain("draft");
  });

  it("distributes test prep across review/practice/final-review", () => {
    const item = makeTest({ workType: "test-prep", estimatedMinutes: 90 });
    const stages = suggestStages(item);
    expect(stages).not.toBeNull();
    expect(stages!.map((s) => s.stageType)).toEqual(["review-concepts", "practice", "final-review"]);
  });

  it("respects a short test-prep estimate — no decomposition below the minimum", () => {
    const item = makeTest({ workType: "test-prep", estimatedMinutes: 30 });
    expect(suggestStages(item)).toBeNull();
  });

  it("stage minutes always sum to exactly the item's total (never double, never short)", () => {
    for (const estimate of [121, 150, 181, 240, 333]) {
      const item = makeProject({ workType: "project", estimatedMinutes: estimate });
      const stages = suggestStages(item)!;
      const total = stages.reduce((sum, s) => sum + s.estimatedMinutes, 0);
      expect(total).toBe(estimate);
    }
  });

  it("orders stages 0..n-1 and chains dependencies linearly", () => {
    const item = makeProject({ workType: "project", estimatedMinutes: 200 });
    const stages = suggestStages(item)!;
    stages.forEach((s, i) => expect(s.order).toBe(i));
    expect(stages[0].dependsOnStageId).toBeUndefined();
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].dependsOnStageId).toBe(stages[i - 1].id);
    }
  });
});

function withStatus(stages: WorkStage[], completedTypes: string[]): WorkStage[] {
  return stages.map((s) => (completedTypes.includes(s.stageType) ? { ...s, status: "completed" as const } : s));
}

describe("stage eligibility and dependency ordering", () => {
  it("only the first stage is eligible before anything is done", () => {
    const stages = suggestStages(makeProject({ workType: "project", estimatedMinutes: 180 }))!;
    expect(nextEligibleStage(stages)?.stageType).toBe("research");
    expect(isStageEligible(stages[1], stages)).toBe(false); // outline depends on research
  });

  it("completing a stage unlocks the next one, in order", () => {
    const stages = suggestStages(makeProject({ workType: "project", estimatedMinutes: 180 }))!;
    const afterResearch = withStatus(stages, ["research"]);
    expect(nextEligibleStage(afterResearch)?.stageType).toBe("outline");
  });

  it("a stage further down the chain never becomes eligible while an earlier one is incomplete", () => {
    const stages = suggestStages(makeProject({ workType: "project", estimatedMinutes: 180 }))!;
    // Research done, Outline explicitly NOT done (e.g. skipped) — Draft must not be offered.
    const afterResearch = withStatus(stages, ["research"]);
    expect(nextEligibleStage(afterResearch)?.stageType).toBe("outline");
    expect(isStageEligible(stages.find((s) => s.stageType === "draft")!, afterResearch)).toBe(false);
  });

  it("returns undefined once every stage is completed", () => {
    const stages = suggestStages(makeProject({ workType: "project", estimatedMinutes: 180 }))!;
    const allDone = stages.map((s) => ({ ...s, status: "completed" as const }));
    expect(nextEligibleStage(allDone)).toBeUndefined();
  });
});

describe("stageProgress / totalRemainingStageMinutes", () => {
  it("reports real completed/total counts, not an estimate", () => {
    const stages = suggestStages(makeProject({ workType: "project", estimatedMinutes: 200 }))!;
    const partial = withStatus(stages, ["research", "outline"]);
    const progress = stageProgress(partial);
    expect(progress.completed).toBe(2);
    expect(progress.total).toBe(5);
    expect(progress.percent).toBe(40);
  });

  it("sums remaining minutes only across not-yet-completed stages, net of actual time logged", () => {
    const stages = suggestStages(makeProject({ workType: "project", estimatedMinutes: 200 }))!;
    const inProgress = stages.map((s) =>
      s.stageType === "research" ? { ...s, status: "completed" as const } : s
    );
    const withPartialDraft = inProgress.map((s) => (s.stageType === "draft" ? { ...s, actualMinutes: 20 } : s));
    const expectedRemaining = withPartialDraft
      .filter((s) => s.status !== "completed")
      .reduce((sum, s) => sum + (s.estimatedMinutes - (s.actualMinutes ?? 0)), 0);
    expect(totalRemainingStageMinutes(withPartialDraft)).toBe(expectedRemaining);
    expect(totalRemainingStageMinutes(withPartialDraft)).toBeLessThan(
      stages.reduce((sum, s) => sum + s.estimatedMinutes, 0)
    );
  });
});

describe("renumberStages", () => {
  it("re-derives order and dependency chain from current order after a structural edit", () => {
    const stages = suggestStages(makeProject({ workType: "project", estimatedMinutes: 180 }))!;
    // Simulate removing the second stage (Outline) — Draft should now directly follow Research.
    const withoutOutline = stages.filter((s) => s.stageType !== "outline");
    const renumbered = renumberStages(withoutOutline);
    expect(renumbered.map((s) => s.order)).toEqual([0, 1, 2, 3]);
    expect(renumbered[0].dependsOnStageId).toBeUndefined();
    expect(renumbered[1].dependsOnStageId).toBe(renumbered[0].id);
    expect(renumbered[1].stageType).toBe("draft");
  });
});

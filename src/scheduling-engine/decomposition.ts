/**
 * Deterministic task decomposition (Phase 4). Turns a large, structured piece of academic work
 * (a project, essay, or test/quiz prep) into an ordered sequence of `WorkStage`s, and answers the
 * one question the scheduler needs about them: which stage, if any, is eligible to be scheduled
 * right now. This module does not schedule anything itself — `scheduler.ts` treats the eligible
 * stage as just another schedulable unit (see the `stagesByWorkItem` substitution in
 * `generateSchedule`), so there is exactly one scheduling algorithm, not two.
 *
 * Conservative by design: only the work types listed in `DECOMPOSITION_MIN_MINUTES`, and only
 * once they clear that type's minimum duration, are ever proposed for decomposition. Short
 * homework and small readings are never turned into stages, no matter how long they're estimated
 * to take.
 */
import { DECOMPOSITION_MIN_MINUTES, ESSAY_STAGE_TEMPLATE, PROJECT_STAGE_TEMPLATE, TEST_PREP_STAGE_TEMPLATE } from "./constants";
import type { StageTemplateEntry } from "./constants";
import type { SchedulableWorkItem } from "./types";
import type { WorkItemStatus, WorkStage } from "@/types/models";

export function isDecomposable(item: SchedulableWorkItem): boolean {
  const threshold = DECOMPOSITION_MIN_MINUTES[item.workType];
  return threshold != null && item.estimatedMinutes >= threshold;
}

function templateFor(item: SchedulableWorkItem): StageTemplateEntry[] | null {
  switch (item.workType) {
    case "project":
    case "long-term":
      return PROJECT_STAGE_TEMPLATE;
    case "essay":
      return ESSAY_STAGE_TEMPLATE;
    case "test-prep":
    case "quiz-prep":
      return TEST_PREP_STAGE_TEMPLATE;
    default:
      return null;
  }
}

/**
 * Proposes a stage breakdown for one work item, or `null` if this item isn't a good decomposition
 * candidate (Phase 4, Part 3). Purely a suggestion — nothing is persisted here; the caller decides
 * whether to accept it (as-is or edited), via the store's `acceptDecomposition`.
 */
export function suggestStages(item: SchedulableWorkItem): WorkStage[] | null {
  if (!isDecomposable(item)) return null;
  const template = templateFor(item);
  if (!template) return null;

  // Round each stage's share, then let the last stage absorb whatever rounding leftover remains
  // so the stages always sum to *exactly* the item's total — never `total + total` and never a
  // few minutes short (Phase 4, Part 26).
  const rawMinutes = template.map((t) => Math.round(item.estimatedMinutes * t.fraction));
  const roundingDrift = item.estimatedMinutes - rawMinutes.reduce((sum, m) => sum + m, 0);
  rawMinutes[rawMinutes.length - 1] += roundingDrift;

  return template.map((t, i) => ({
    id: `${item.id}_stage_${i}`,
    workItemId: item.id,
    title: t.title,
    stageType: t.stageType,
    order: i,
    estimatedMinutes: rawMinutes[i],
    status: "not-started" as WorkItemStatus,
    dependsOnStageId: i > 0 ? `${item.id}_stage_${i - 1}` : undefined,
  }));
}

/** A stage is eligible once it isn't already completed and whatever it depends on is. */
export function isStageEligible(stage: WorkStage, allStages: WorkStage[]): boolean {
  if (stage.status === "completed") return false;
  if (!stage.dependsOnStageId) return true;
  const dependency = allStages.find((s) => s.id === stage.dependsOnStageId);
  return !dependency || dependency.status === "completed";
}

/**
 * The single stage (if any) the scheduler should treat as this item's schedulable unit right now
 * (Phase 4, Part 8/11). Because every template here is a strictly linear chain, the earliest
 * not-completed stage in order is always the one whose dependency (if any) is already satisfied —
 * a later stage can never be returned while an earlier one is still incomplete.
 */
export function nextEligibleStage(stages: WorkStage[]): WorkStage | undefined {
  return [...stages].sort((a, b) => a.order - b.order).find((s) => isStageEligible(s, stages));
}

export interface StageProgress {
  completed: number;
  total: number;
  percent: number;
}

/** Real progress from actual stage status — never a fabricated or estimated percentage (Part 14). */
export function stageProgress(stages: WorkStage[]): StageProgress {
  const total = stages.length;
  const completed = stages.filter((s) => s.status === "completed").length;
  return { completed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) };
}

/** Minutes still owed across every not-yet-completed stage — the honest "remaining" figure for a
 *  decomposed item's own display (Part 14/27), independent of which single stage the engine is
 *  currently allowed to schedule. */
export function totalRemainingStageMinutes(stages: WorkStage[]): number {
  return stages
    .filter((s) => s.status !== "completed")
    .reduce((sum, s) => sum + Math.max(0, s.estimatedMinutes - (s.actualMinutes ?? 0)), 0);
}

/**
 * Re-derives `order` (0..n-1, by current order) and `dependsOnStageId` (each stage depends on
 * whichever stage now precedes it) for one item's stages. Used after every structural edit
 * (add/remove/reorder) so the linear-chain invariant `isStageEligible` relies on always holds,
 * instead of hand-patching dependency pointers at each call site.
 */
export function renumberStages(stages: WorkStage[]): WorkStage[] {
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  return sorted.map((stage, i) => ({
    ...stage,
    order: i,
    dependsOnStageId: i > 0 ? sorted[i - 1].id : undefined,
  }));
}

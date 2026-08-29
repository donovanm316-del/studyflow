/**
 * Public entry point for the scheduling engine. UI code should only import from this file
 * (or `./types` for shared input/output types), never from internal modules — that keeps the
 * implementation free to change without breaking callers.
 *
 * See ./README.md for the module's responsibilities and Phase 2 status.
 */
export { generateSchedule, replanRemainingSchedule, scheduleTask, detectOverload } from "./scheduler";
export { calculatePriority, calculateUrgency, explainPriority, isOverdue } from "./priority";
export {
  calculateDailyCapacity,
  calculateFeedbackAdjustment,
  calculateBreakPreferenceAdjustment,
  calculateFreeTimePriorityAdjustment,
} from "./capacity";
export { findAvailableWindows, subtractIntervals } from "./availability";
export { splitTask, sessionBounds, isSplittableWorkType } from "./splitting";
export { calculateWorkloadStatus } from "./workload-status";
export { explainScheduleDecision } from "./explanation";
export { diffSchedules } from "./schedule-diff";
export { calculateAvailableMinutesBeforeDeadline, calculateDeadlineCapacity } from "./deadline-capacity";
export { buildEstimateHistory, personalizeEstimate } from "./estimation";
export type { EstimateAdjustment, EstimateConfidence, EstimateHistory, EstimateMatchLevel } from "./estimation";
export type { AvailableTimeOptions, DeadlineCapacity, DeadlineRiskLevel } from "./deadline-capacity";
export {
  isDecomposable,
  suggestStages,
  isStageEligible,
  nextEligibleStage,
  stageProgress,
  totalRemainingStageMinutes,
  renumberStages,
} from "./decomposition";
export type { StageProgress } from "./decomposition";
export {
  minutesOfDay,
  formatMinutesAsHoursMinutes,
  blockDurationMinutes,
  toDateOnly,
  normalizeDeadline,
  minutesUntil,
  hoursUntil,
  DEFAULT_DEADLINE_TIME,
} from "./date-utils";

export type {
  DailyForecastEntry,
  EstimateAccuracySample,
  GenerateScheduleInput,
  GenerateScheduleResult,
  PriorityBreakdown,
  ReplanInput,
  SchedulableWorkItem,
  ScheduleChangeSummary,
  ScheduleDecisionExplanation,
  ScheduleWarning,
  WorkAheadSuggestion,
  WorkItemScheduleChange,
  WorkloadStatus,
} from "./types";
export type { TimeWindow } from "./availability";
export type { DaySlot, PlannedChunk } from "./splitting";
export type { DailyCapacityContext } from "./capacity";

import {
  ESTIMATE_CONFIDENCE_WEIGHT,
  ESTIMATE_MAX_RATIO,
  ESTIMATE_MIN_RATIO,
  ESTIMATE_MIN_SAMPLES,
  ESTIMATE_RECENT_WINDOW,
} from "./constants";
import type { EstimateAccuracySample } from "./types";

/**
 * Rolls estimate-vs-actual samples into a refined estimate for similar future work (Phase 4.5C —
 * previously a documented stub). Deliberately the same median/damp/clamp rule
 * `personalizeEstimate` applies, just over a bare sample list rather than categorized history, so
 * there is one definition of how history moves an estimate.
 */
export function refineEstimate(baseMinutes: number, samples: EstimateAccuracySample[]): number {
  const ratios = samples
    .filter((s) => s.estimatedMinutes > 0 && s.actualMinutes > 0)
    .slice(-ESTIMATE_RECENT_WINDOW)
    .map((s) => s.actualMinutes / s.estimatedMinutes)
    .sort((a, b) => a - b);

  if (ratios.length < ESTIMATE_MIN_SAMPLES) return baseMinutes;

  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid];
  const weight = ESTIMATE_CONFIDENCE_WEIGHT.limited;
  const applied = Math.min(ESTIMATE_MAX_RATIO, Math.max(ESTIMATE_MIN_RATIO, 1 + (median - 1) * weight));
  return Math.max(5, Math.round((baseMinutes * applied) / 5) * 5);
}

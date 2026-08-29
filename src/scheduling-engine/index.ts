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

import type { EstimateAccuracySample } from "./types";

/**
 * Roll estimate-vs-actual samples into an updated estimated-minutes figure for future similar
 * work items. Out of scope for Phase 2 (which only *records* estimate-vs-actual data — see
 * `WorkSession.plannedMinutes`/`minutesSpent` in `types/models.ts`); this stays a stub until a
 * later phase actually builds the learning heuristic.
 */
export function refineEstimate(_samples: EstimateAccuracySample[]): number {
  throw new Error("refineEstimate: not implemented yet (future phase)");
}

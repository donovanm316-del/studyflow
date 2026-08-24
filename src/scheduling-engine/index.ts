/**
 * Public entry point for the scheduling engine. UI code should only import from this file
 * (or `./types` for shared input/output types), never from internal modules — that keeps the
 * implementation free to change without breaking callers.
 *
 * See ./README.md for the module's responsibilities and Phase 2 status.
 */
export { generateSchedule, replan, scheduleTask, detectOverload } from "./scheduler";
export { calculatePriority, calculateUrgency, explainPriority, isOverdue } from "./priority";
export { calculateDailyCapacity } from "./capacity";
export { findAvailableWindows } from "./availability";
export { splitTask, sessionBounds, isSplittableWorkType } from "./splitting";

export type {
  EstimateAccuracySample,
  GenerateScheduleInput,
  GenerateScheduleResult,
  PriorityBreakdown,
  ReplanInput,
  SchedulableWorkItem,
  ScheduleWarning,
  WorkAheadSuggestion,
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

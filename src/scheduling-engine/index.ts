/**
 * Public entry point for the scheduling engine. UI code should only import
 * from this file, never from internal modules added later — that keeps the
 * implementation free to change without breaking callers.
 *
 * See ./README.md for the module's intended responsibilities and status.
 *
 * Nothing below is implemented yet. These signatures exist to (a) let the UI
 * layer be written against a stable contract now, and (b) document the shape
 * of Phase 1B work before it starts.
 */
import type {
  EstimateAccuracySample,
  GenerateScheduleInput,
  GenerateScheduleResult,
  ReplanInput,
} from "./types";
import type { ScheduleBlock } from "@/types/models";

/**
 * Build a schedule of blocks for the given date range from scratch.
 * Phase 1B: implement availability calculation + placement.
 */
export function generateSchedule(
  _input: GenerateScheduleInput
): GenerateScheduleResult {
  throw new Error("generateSchedule: not implemented yet (Phase 1B)");
}

/**
 * Recompute affected blocks after a change, preserving unaffected ones.
 * Phase 1B/1C: implement incremental replanning.
 */
export function replan(_input: ReplanInput): ScheduleBlock[] {
  throw new Error("replan: not implemented yet (Phase 1B)");
}

/**
 * Roll estimate-vs-actual samples into an updated estimated-minutes figure
 * for future similar work items. Phase 1C: implement the learning heuristic.
 */
export function refineEstimate(
  _samples: EstimateAccuracySample[]
): number {
  throw new Error("refineEstimate: not implemented yet (Phase 1C)");
}

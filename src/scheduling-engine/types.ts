/**
 * Types used only by the scheduling engine's internal contracts (inputs and
 * outputs of its future functions). Shared domain models (Assignment, Test,
 * ScheduleBlock, etc.) live in `src/types/models.ts` and are imported here,
 * not duplicated.
 */
import type {
  Assignment,
  Commitment,
  PlanningProfile,
  Project,
  Quiz,
  ScheduleBlock,
  Test,
} from "@/types/models";

/** Anything the engine can schedule time for. */
export type SchedulableWorkItem = Assignment | Test | Quiz | Project;

/** Input bundle for generating a schedule over a date range. */
export interface GenerateScheduleInput {
  userId: string;
  rangeStart: string; // ISO date
  rangeEnd: string; // ISO date
  workItems: SchedulableWorkItem[];
  commitments: Commitment[];
  planningProfile: PlanningProfile;
  /** Existing blocks the engine should try to preserve where possible (e.g. manual overrides). */
  existingBlocks?: ScheduleBlock[];
}

export interface GenerateScheduleResult {
  blocks: ScheduleBlock[];
  /** Work items the engine could not fully schedule before their due date, given constraints. */
  unscheduledWorkItemIds: string[];
}

/** Input for recomputing a plan after something changes (missed session, new item, moved due date). */
export interface ReplanInput {
  userId: string;
  reason: "missed-session" | "new-work-item" | "due-date-changed" | "manual-edit";
  currentBlocks: ScheduleBlock[];
  workItems: SchedulableWorkItem[];
  commitments: Commitment[];
  planningProfile: PlanningProfile;
}

/** A single estimate-vs-actual data point, used for both learning and insight reporting. */
export interface EstimateAccuracySample {
  workItemId: string;
  estimatedMinutes: number;
  actualMinutes: number;
}

/**
 * Types used only by the scheduling engine's internal contracts (inputs and
 * outputs of its functions). Shared domain models (Assignment, Test,
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
  ScheduleFeedback,
  Test,
} from "@/types/models";

/** Anything the engine can schedule time for. */
export type SchedulableWorkItem = Assignment | Test | Quiz | Project;

/** Input bundle for generating a schedule over a date range. */
export interface GenerateScheduleInput {
  userId: string;
  rangeStart: string; // ISO date ("YYYY-MM-DD")
  rangeEnd: string; // ISO date ("YYYY-MM-DD")
  /** Current moment, as an ISO date-time — injected rather than read from the clock, so runs are deterministic. */
  now: string;
  workItems: SchedulableWorkItem[];
  commitments: Commitment[];
  planningProfile: PlanningProfile;
  /**
   * Blocks the engine must not move or overwrite: manual overrides, and anything already
   * completed or skipped. Blocks in this list occupy time the same way commitments do.
   */
  existingBlocks?: ScheduleBlock[];
  /**
   * Past "how did this schedule feel?" responses (Part 11 of the Phase 2.5 spec). Used only to
   * compute a small, bounded daily-capacity nudge — see `calculateFeedbackAdjustment` in
   * capacity.ts. Not required; omitting it (or passing none) means no adjustment is applied.
   */
  feedback?: ScheduleFeedback[];
}

/** One factor breakdown behind a single work item's priority score (Part 3 / Part 15). */
export interface PriorityBreakdown {
  workItemId: string;
  score: number;
  factors: {
    weight: number;
    urgency: number;
    strictness: number;
    workload: number;
    type: number;
    overdue: number;
  };
}

export interface ScheduleWarning {
  kind: "overloaded-range" | "unscheduled-hard-deadline";
  message: string;
  workItemIds: string[];
}

/** An optional, never-auto-scheduled suggestion for using slack time productively (Part 11). */
export interface WorkAheadSuggestion {
  workItemId: string;
  title: string;
  reason: string;
}

export interface GenerateScheduleResult {
  blocks: ScheduleBlock[];
  /** Work items the engine could not fully schedule before their due date, given constraints. */
  unscheduledWorkItemIds: string[];
  /** Priority breakdowns for every work item considered, keyed by work item id (Part 15). */
  priorities: Record<string, PriorityBreakdown>;
  warnings: ScheduleWarning[];
  /** True when there's no overdue work and everything upcoming is adequately planned (Part 11). */
  caughtUp: boolean;
  workAheadSuggestions: WorkAheadSuggestion[];
  /**
   * The multiplier actually applied to daily capacity based on recent feedback (1 = no
   * adjustment). Exposed so the UI can explain *why* a schedule feels lighter/heavier than usual
   * — see `calculateFeedbackAdjustment` in capacity.ts.
   */
  feedbackAdjustment: number;
}

/** Input for recomputing a plan after something changes (missed session, new item, moved due date). */
export interface ReplanInput extends GenerateScheduleInput {
  reason: "missed-session" | "new-work-item" | "due-date-changed" | "manual-edit";
}

/** A single estimate-vs-actual data point, used for both learning and insight reporting. */
export interface EstimateAccuracySample {
  workItemId: string;
  estimatedMinutes: number;
  actualMinutes: number;
}

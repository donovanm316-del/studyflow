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
  WorkStage,
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
  /**
   * Stages for any decomposed work items (Phase 4), across all items — grouped by `workItemId`
   * internally. A work item with no entries here (or all of whose stages are completed) is
   * scheduled as a single unit exactly as before; one with eligible stages has only its next
   * eligible stage (see `nextEligibleStage` in decomposition.ts) treated as schedulable, never the
   * item as a whole and never more than one stage at a time.
   */
  stages?: WorkStage[];
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
  /** "review" for an upcoming test/quiz, "work-ahead" for a project/essay/long-term item (Part 7). */
  type: "work-ahead" | "review";
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
  /** On-track / getting-tight / at-risk / ahead, grounded in this same result's numbers (Part 6). */
  workloadStatus: WorkloadStatus;
  /** Per-day projected workload vs. available time across the requested range (Part 8). */
  dailyForecast: DailyForecastEntry[];
  /** A "why was this scheduled" breakdown per work item that has at least one block placed (Phase 3B, Part 4/5). */
  decisionExplanations: Record<string, ScheduleDecisionExplanation>;
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

/**
 * A reusable "how is the student doing against their real workload" status (Phase 3A, Part 6).
 * Grounded entirely in the same demand/availability numbers `detectOverload` already computes —
 * this is a different lens on the same data, not a second competing calculation.
 */
export interface WorkloadStatus {
  level: "ahead" | "on-track" | "getting-tight" | "at-risk";
  message: string;
  estimatedRemainingMinutes: number;
  availableMinutes: number;
  /** availableMinutes - estimatedRemainingMinutes; negative means demand exceeds availability. */
  bufferMinutes: number;
}

/** One day's worth of projected workload vs. available time (Phase 3A, Part 8), from real engine output. */
export interface DailyForecastEntry {
  date: string; // "YYYY-MM-DD"
  workMinutes: number;
  availableMinutes: number;
}

/**
 * A structured "why was this scheduled" breakdown for one work item (Phase 3B, Part 4/5).
 * `primaryReason` is a single sentence (reuses `explainPriority`); `bullets` are short,
 * independently-true statements built only from data the engine already computed elsewhere in
 * this same result — nothing here is invented or estimated separately from the real placement.
 */
export interface ScheduleDecisionExplanation {
  workItemId: string;
  primaryReason: string;
  bullets: string[];
}

/** One work item's schedule footprint changing between two `generateSchedule` results (Phase 3B, Part 6/7). */
export interface WorkItemScheduleChange {
  workItemId: string;
  title: string;
  kind: "added" | "removed" | "moved" | "duration-changed";
  /** Human-readable "before"/"after", omitted where not applicable (e.g. `before` for "added"). */
  before?: string;
  after?: string;
}

/** The result of comparing two schedules — only the work items that actually changed (Part 7). */
export interface ScheduleChangeSummary {
  changes: WorkItemScheduleChange[];
}

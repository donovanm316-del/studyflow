/**
 * Core domain models for StudyFlow.
 *
 * These types describe the data the scheduling engine and UI will eventually
 * operate on. Phase 1A does not persist any of this to a database — these
 * interfaces exist so the UI and the scheduling engine can be built against a
 * stable shape from day one. Nothing here is wired to real storage yet.
 */

/** A student using the app. Auth/session handling is not implemented in Phase 1A. */
export interface User {
  id: string;
  name: string;
  email: string;
  gradeLevel?: GradeLevel;
  createdAt: string; // ISO date
}

export type GradeLevel =
  | "middle-school"
  | "high-school-9"
  | "high-school-10"
  | "high-school-11"
  | "high-school-12"
  | "college";

/** Shared fields for anything that occupies a student's workload. */
interface WorkItemBase {
  id: string;
  userId: string;
  title: string;
  subject?: string;
  dueDate: string; // ISO date-time
  status: WorkItemStatus;
  /** Estimated minutes of focused work required. Set by the student or, later, learned from history. */
  estimatedMinutes: number;
  /** Actual minutes spent, accumulated from completed WorkSessions. Used later for estimate-learning. */
  actualMinutes?: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;

  /** How much this item counts toward the student's grade/importance. Feeds priority scoring. */
  weight: AssignmentWeight;
  /** How firm the due date is. Hard deadlines dominate priority; targets are student-set goals. */
  deadlineStrictness: DeadlineStrictness;
  /** Finer-grained category than `kind` — used to decide splittability and session shape. */
  workType: WorkType;
  /** Rigor of the course this work belongs to. Influences workload capacity, never invents work. */
  rigor?: CourseRigor;
  /**
   * Whether this item can be split across multiple work sessions. Defaults by workType when
   * omitted (see `isSplittableWorkType` in the scheduling engine) — projects/essays/long-term
   * work default to splittable, single-sitting homework does not.
   */
  splittable?: boolean;
  /**
   * Optional student-set "don't start before this date" hint (Phase 3A). Purely a scheduling
   * constraint — it never changes priority or urgency, it just excludes earlier dates from the
   * item's schedulable window (e.g. a project the student doesn't want to think about until
   * next week, even though there'd be room to start it sooner).
   */
  preferredStartDate?: string; // ISO date ("YYYY-MM-DD")
}

export type WorkItemStatus = "not-started" | "in-progress" | "completed";

export type AssignmentWeight = "low" | "medium" | "high";

export type DeadlineStrictness = "hard" | "important" | "flexible" | "target";

export type WorkType =
  | "homework"
  | "reading"
  | "study-session"
  | "test-prep"
  | "quiz-prep"
  | "project"
  | "essay"
  | "long-term";

export type CourseRigor =
  | "grade_level"
  | "honors"
  | "ap"
  | "ib"
  | "college_level"
  | "advanced";

/** A generic assignment (homework, reading, worksheets, etc). */
export interface Assignment extends WorkItemBase {
  kind: "assignment";
}

/** A test or exam. */
export interface Test extends WorkItemBase {
  kind: "test";
  /** Roughly how heavy this test is expected to be, to weight scheduling later. */
  scope?: "quiz" | "unit-test" | "midterm" | "final";
}

/** A short-form quiz, kept distinct from Test because it typically needs less prep time. */
export interface Quiz extends WorkItemBase {
  kind: "quiz";
}

/** A multi-stage project with its own milestones, distinct from a single-sitting assignment. */
export interface Project extends WorkItemBase {
  kind: "project";
  milestones?: ProjectMilestone[];
}

export interface ProjectMilestone {
  id: string;
  title: string;
  dueDate: string;
  status: WorkItemStatus;
}

/** Any recurring or fixed obligation outside of schoolwork: sports, clubs, jobs, family commitments. */
export interface Commitment {
  id: string;
  userId: string;
  title: string;
  category: "school" | "sports" | "club" | "work" | "family" | "appointment" | "other";
  /** Recurring weekly commitments (e.g. practice every Tuesday) vs one-off events. */
  recurrence: CommitmentRecurrence;
  startTime: string; // ISO date-time for one-off, or HH:mm for recurring
  endTime: string;
  location?: string;
}

export type CommitmentRecurrence =
  | { type: "one-off"; date: string } // ISO date
  | { type: "weekly"; daysOfWeek: number[] }; // 0 = Sunday .. 6 = Saturday

/**
 * A block of time the scheduling engine has assigned to a piece of work.
 * This is the engine's output — the UI renders these, it does not create them directly
 * (except for manual overrides, which the UI creates and the engine then treats as fixed).
 */
export interface ScheduleBlock {
  id: string;
  userId: string;
  /** The work item this block is time allocated to, if any (blocks can also represent commitments or breaks). */
  workItemId?: string;
  workItemKind?: "assignment" | "test" | "quiz" | "project";
  title: string;
  start: string; // ISO date-time
  end: string; // ISO date-time
  /**
   * Whether this block was placed by the engine, is a rest break, was manually adjusted by the
   * student, or is a materialized occurrence of a fixed `Commitment` (regenerated for display on
   * every call, not persisted separately — the `Commitment` itself is the source of truth).
   */
  origin: "generated" | "manual-override" | "break" | "commitment";
  status: "planned" | "completed" | "skipped";
  /** The priority score behind this placement, when it represents work (not a break/commitment). */
  priorityScore?: number;
  /** Human-readable explanation of why this block was scheduled here — see `explainPriority`. */
  reason?: string;
}

/** A logged record of time actually spent working, used to compare estimate vs. actual. */
export interface WorkSession {
  id: string;
  userId: string;
  workItemId: string;
  scheduleBlockId?: string;
  start: string; // ISO date-time
  end?: string; // ISO date-time, absent while a session is in progress
  /** How long the engine planned this session to be, for estimate-vs-actual comparison. */
  plannedMinutes?: number;
  minutesSpent?: number;
  /** True if the student postponed/skipped the originally planned session rather than completing it. */
  postponed?: boolean;
  /**
   * Lightweight post-session feedback on the estimate (Phase 3A, Part 5) — feeds
   * estimate-vs-actual insights. Not used for any learning/ML, just recorded.
   */
  estimateFeedback?: "much-faster" | "about-right" | "took-longer";
}

/**
 * A single in-progress work session (Phase 3A, Part 4). At most one is active at a time — this
 * is intentionally not a full timer app, just enough to record an accurate start time so
 * "actual minutes spent" doesn't have to be hand-estimated after the fact. `blockId` is absent
 * for an ad-hoc session started directly from a work-ahead/review suggestion rather than a
 * scheduled block.
 */
export interface ActiveWorkSession {
  blockId?: string;
  workItemId: string;
  workItemTitle: string;
  plannedMinutes?: number;
  startedAt: string; // ISO date-time
}

/**
 * Lightweight, explicit feedback a student gives on a generated schedule. Used only to inform
 * future personalization by hand — this is not fed into any learning or ML system in Phase 2.
 */
export interface ScheduleFeedback {
  id: string;
  userId: string;
  /** ISO date the feedback applies to (the day, or the first day of the week, being rated). */
  dateRange: { start: string; end: string };
  workloadFeeling: "too-light" | "just-right" | "too-heavy";
  breaksFeeling?: "too-few" | "just-right" | "too-many";
  /** How much free/protected time the student wants relative to now (Phase 3A check-in). */
  freeTimeFeeling?: "more" | "about-right" | "less";
  /** Whether the student would rather work earlier or later in the day (Phase 3A check-in). Recorded for Insights only — not auto-applied, since shifting daily availability windows is a bigger decision than a bounded capacity/preference nudge. */
  timingFeeling?: "earlier" | "about-right" | "later";
  createdAt: string;
}

/**
 * Per-student preferences that steer how the scheduling engine builds a plan.
 * Settings exposes real controls for these as of Phase 2.
 */
export interface PlanningProfile {
  userId: string;
  /** Earliest/latest the student is willing to have work scheduled, per day. */
  dailyAvailability: {
    dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
    earliest: string; // HH:mm
    latest: string; // HH:mm
  }[];
  /** Preferred length of a single work block, in minutes, before a break is suggested. */
  preferredSessionMinutes: number;
  /** How many days before a due date the engine should try to have work finished. */
  bufferDays: number;
  /** Whether the student wants breaks inserted automatically between sessions. */
  autoBreaks: boolean;

  /** How much daily workload the student is comfortable with. See scheduling-engine/constants.ts. */
  workloadTolerance: WorkloadTolerance;
  /** How often the student wants breaks, which shapes session length bounds. */
  breakPreference: BreakPreference;
  /** How aggressively the scheduler should protect unallocated/free time. */
  freeTimePriority: FreeTimePriority;
  /** Whether the student prefers to finish early, spread work evenly, or work closer to deadlines. */
  workStyle: WorkStyle;
  /**
   * A sensible starting rigor for new work items (Phase 3B onboarding, Part 1 Step 2) — purely a
   * UI default for the add/edit item form. The scheduling engine only ever reads each work item's
   * own `rigor` field (see `capacity.ts`); this never feeds the engine directly.
   */
  defaultRigor?: CourseRigor;
}

export type WorkloadTolerance = "light" | "moderate" | "heavy" | "adaptive";
export type BreakPreference = "frequent" | "balanced" | "minimal";
export type FreeTimePriority = "high" | "medium" | "low";
export type WorkStyle = "early" | "consistent" | "deadline_driven" | "adaptive";

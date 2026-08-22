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
}

export type WorkItemStatus = "not-started" | "in-progress" | "completed";

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
  category: "extracurricular" | "work" | "family" | "personal" | "other";
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
 * This is the engine's output — the UI renders these, it does not create them directly.
 */
export interface ScheduleBlock {
  id: string;
  userId: string;
  /** The work item this block is time allocated to, if any (blocks can also represent commitments). */
  workItemId?: string;
  workItemKind?: "assignment" | "test" | "quiz" | "project";
  title: string;
  start: string; // ISO date-time
  end: string; // ISO date-time
  /** Whether this block was placed by the engine or manually adjusted by the student. */
  origin: "generated" | "manual-override";
  status: "planned" | "completed" | "skipped";
}

/** A logged record of time actually spent working, used to compare estimate vs. actual. */
export interface WorkSession {
  id: string;
  userId: string;
  workItemId: string;
  scheduleBlockId?: string;
  start: string; // ISO date-time
  end?: string; // ISO date-time, absent while a session is in progress
  minutesSpent?: number;
}

/**
 * Per-student preferences that steer how the scheduling engine builds a plan.
 * None of these are surfaced with real controls yet — Settings only sketches the shape.
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
}

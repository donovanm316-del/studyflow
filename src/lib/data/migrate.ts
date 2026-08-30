/**
 * Turning whatever is in localStorage into a usable `AppState` (Phase 4.5D, Part 14).
 *
 * Previously the store did `JSON.parse(raw) as AppState` and then read fields off it directly. The
 * cast is a lie: the stored value is whatever a previous version of the app (or a partially failed
 * write, or a hand-edited entry) left behind. A `workItems` that wasn't an array would throw inside
 * the hydration effect and take the whole app down, with the student's data still sitting intact in
 * storage. This coerces every field defensively instead, so a damaged save degrades to "some
 * sections are empty" rather than a blank screen.
 *
 * Migrations here are additive only — nothing is dropped or rewritten beyond filling in values that
 * newer phases introduced.
 */
import { normalizeDeadline, type SchedulableWorkItem } from "@/scheduling-engine";
import type {
  ActiveWorkSession,
  Commitment,
  PlanningProfile,
  ScheduleBlock,
  ScheduleFeedback,
  WorkSession,
  WorkStage,
} from "@/types/models";

export const DEMO_USER_ID = "demo-user";

export const DEFAULT_PLANNING_PROFILE: PlanningProfile = {
  userId: DEMO_USER_ID,
  dailyAvailability: [],
  preferredSessionMinutes: 45,
  bufferDays: 1,
  autoBreaks: true,
  workloadTolerance: "moderate",
  breakPreference: "balanced",
  freeTimePriority: "medium",
  workStyle: "early",
};

export interface AppState {
  workItems: SchedulableWorkItem[];
  commitments: Commitment[];
  planningProfile: PlanningProfile;
  /** Only completed/skipped/manual-override blocks are persisted — generated ones are recomputed live. */
  fixedBlocks: ScheduleBlock[];
  workSessions: WorkSession[];
  feedback: ScheduleFeedback[];
  /** Stages for decomposed work items (Phase 4), across every item. */
  stages: WorkStage[];
  /** At most one work session in progress at a time (Phase 3A, Part 4). */
  activeSession: ActiveWorkSession | null;
  /**
   * False only for a genuine first-ever visit (no saved data at all) — gates the onboarding
   * redirect. Existing users are never sent back through onboarding.
   */
  onboardingComplete: boolean;
  /**
   * Which Google Classroom courses the student chose to sync (Phase 5B). Empty means "all active
   * courses", which is where a student starts before narrowing anything down.
   *
   * A planning preference, so it lives with the student's data rather than in the connection
   * cookie: it should survive disconnecting and reconnecting, and it is nobody's business but
   * theirs.
   */
  classroomCourseIds: string[];
  /** When coursework was last retrieved. Absent until a sync has actually run. */
  classroomLastSyncAt?: string;
}

export function emptyState(onboardingComplete: boolean): AppState {
  return {
    workItems: [],
    commitments: [],
    planningProfile: DEFAULT_PLANNING_PROFILE,
    fixedBlocks: [],
    workSessions: [],
    feedback: [],
    stages: [],
    activeSession: null,
    onboardingComplete,
    classroomCourseIds: [],
  };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param parsed  whatever `JSON.parse` produced, or `null` if nothing was stored / parsing failed
 * @param hadSavedData  whether storage held *something*. A value that failed to parse belongs to a
 *   student who already had data, so they're treated as an existing user with a damaged save rather
 *   than a first-timer being sent through onboarding.
 */
export function migrateSavedState(parsed: unknown, hadSavedData: boolean): AppState {
  if (!isRecord(parsed)) return emptyState(hadSavedData);

  const profile = isRecord(parsed.planningProfile)
    ? { ...DEFAULT_PLANNING_PROFILE, ...(parsed.planningProfile as Partial<PlanningProfile>) }
    : DEFAULT_PLANNING_PROFILE;

  return {
    // Pre-Phase-4.5A saves may hold a bare "YYYY-MM-DD" deadline; a date with no time means the end
    // of that day, 11:59 PM. Items that aren't objects are dropped rather than crashing the engine.
    workItems: asArray<SchedulableWorkItem>(parsed.workItems)
      .filter(isRecord)
      .map((item) => ({ ...item, dueDate: normalizeDeadline(String(item.dueDate ?? "")) })) as SchedulableWorkItem[],
    commitments: asArray<Commitment>(parsed.commitments),
    planningProfile: {
      ...profile,
      // The engine indexes availability by day, so a missing/!array value would break scheduling.
      dailyAvailability: asArray(profile.dailyAvailability),
    },
    fixedBlocks: asArray<ScheduleBlock>(parsed.fixedBlocks),
    workSessions: asArray<WorkSession>(parsed.workSessions),
    feedback: asArray<ScheduleFeedback>(parsed.feedback),
    // Pre-Phase-4 saves have no `stages` at all — items simply behave as single-stage work.
    stages: asArray<WorkStage>(parsed.stages),
    activeSession: isRecord(parsed.activeSession) ? (parsed.activeSession as unknown as ActiveWorkSession) : null,
    // Any successfully-loaded save, including one predating this field, is an existing user.
    onboardingComplete: typeof parsed.onboardingComplete === "boolean" ? parsed.onboardingComplete : true,
    // Pre-Phase-5B saves have no course selection — an empty list reads as "all active courses",
    // which is the same thing a newly-connected student gets.
    classroomCourseIds: asArray<string>(parsed.classroomCourseIds).filter((id) => typeof id === "string"),
    classroomLastSyncAt: typeof parsed.classroomLastSyncAt === "string" ? parsed.classroomLastSyncAt : undefined,
  };
}

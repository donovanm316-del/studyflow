/**
 * Pure mapping from onboarding answers to a real `PlanningProfile` (Phase 3B, Part 1). Kept
 * separate from the onboarding page component so "does onboarding produce a valid profile" is
 * testable without rendering React — the wizard itself just collects these fields and calls this
 * once at the end.
 */
import type { BreakPreference, CourseRigor, FreeTimePriority, PlanningProfile, WorkStyle, WorkloadTolerance } from "@/types/models";

export interface OnboardingAnswers {
  rigor: CourseRigor;
  workloadTolerance: WorkloadTolerance;
  breakPreference: BreakPreference;
  freeTimePriority: FreeTimePriority;
  workStyle: WorkStyle;
  dailyAvailability: PlanningProfile["dailyAvailability"];
}

/** A reasonable, editable-later starting availability window — not fabricated work, just a default schedule shape. */
export const DEFAULT_ONBOARDING_AVAILABILITY: PlanningProfile["dailyAvailability"] = [0, 1, 2, 3, 4, 5, 6].map(
  (dayOfWeek) => ({
    dayOfWeek,
    earliest: dayOfWeek === 0 || dayOfWeek === 6 ? "10:00" : "15:30",
    latest: "21:00",
  })
);

export const DEFAULT_ONBOARDING_ANSWERS: OnboardingAnswers = {
  rigor: "grade_level",
  workloadTolerance: "moderate",
  breakPreference: "balanced",
  freeTimePriority: "medium",
  workStyle: "early",
  dailyAvailability: DEFAULT_ONBOARDING_AVAILABILITY,
};

export function buildPlanningProfileFromOnboarding(answers: OnboardingAnswers, userId: string): PlanningProfile {
  return {
    userId,
    dailyAvailability: answers.dailyAvailability,
    preferredSessionMinutes: 45,
    bufferDays: 1,
    autoBreaks: true,
    workloadTolerance: answers.workloadTolerance,
    breakPreference: answers.breakPreference,
    freeTimePriority: answers.freeTimePriority,
    workStyle: answers.workStyle,
    defaultRigor: answers.rigor,
  };
}

/** True if a day's earliest/latest availability window is well-formed (used by the Availability step's form validation). */
export function isValidAvailabilityWindow(earliest: string, latest: string): boolean {
  return /^\d{2}:\d{2}$/.test(earliest) && /^\d{2}:\d{2}$/.test(latest) && earliest < latest;
}

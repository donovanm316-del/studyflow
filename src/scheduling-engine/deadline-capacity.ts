/**
 * "How much usable work time is actually left before this deadline?" (Phase 4.5A, Part 7/8).
 *
 * The distinction this module exists to make: `deadline - now` is wall-clock time, not work time.
 * A task due in 14 hours at 8 AM tomorrow does not have 14 hours of capacity behind it — most of
 * that span is overnight, and whatever is left may already be spent on practice, a shift, or work
 * this student has already committed to. This computes the honest figure by reusing the same
 * `findAvailableWindows` the scheduler itself places work into, so the two can never disagree
 * about what "available" means.
 */
import { DEADLINE_COMFORT_FACTOR, IMMINENT_DEADLINE_HOURS } from "./constants";
import { findAvailableWindows } from "./availability";
import { dateRange, minutesOfDay, minutesUntil, normalizeDeadline, toDateOnly } from "./date-utils";
import type { Commitment, PlanningProfile, ScheduleBlock } from "@/types/models";

export interface AvailableTimeOptions {
  /**
   * Per-day soft capacity target. When supplied, each day contributes at most this many minutes —
   * matching how `generateSchedule` computes its own `totalAvailableMinutes`, so a "you have 9h
   * before this deadline" figure reflects time the engine would actually schedule into, not every
   * waking minute in the student's availability window.
   */
  dailyCapacityMinutes?: number;
  /** The item's "don't start before" hint — time before it isn't usable for this item. */
  preferredStartDate?: string;
}

/**
 * Usable work minutes between `now` and `deadline`, after removing sleep/unavailable hours
 * (anything outside `dailyAvailability`), fixed commitments, and time already occupied by
 * existing blocks. Returns 0 for a deadline that has already passed.
 */
export function calculateAvailableMinutesBeforeDeadline(
  deadline: string,
  now: string,
  profile: PlanningProfile,
  commitments: Commitment[],
  existingBlocks: ScheduleBlock[],
  options: AvailableTimeOptions = {}
): number {
  const deadlineIso = normalizeDeadline(deadline);
  if (minutesUntil(now, deadlineIso) <= 0) return 0;

  const today = toDateOnly(now);
  const nowMinute = minutesOfDay(now.split("T")[1] ?? "00:00");
  const deadlineDate = toDateOnly(deadlineIso);
  const deadlineMinute = minutesOfDay(deadlineIso.split("T")[1]);

  // A preferred start date narrows the window, but never past today — same rule the scheduler
  // uses: it's a preference about when to begin, not a way to shrink a deadline that's already close.
  const start =
    options.preferredStartDate && options.preferredStartDate > today ? options.preferredStartDate : today;
  if (start > deadlineDate) return 0;

  let total = 0;
  for (const date of dateRange(start, deadlineDate)) {
    const windows = findAvailableWindows(date, profile, commitments, existingBlocks);

    let dayMinutes = 0;
    for (const window of windows) {
      // Clip the first day at the current time (hours already past aren't available) and the last
      // day at the deadline itself (work finishing after the deadline doesn't count toward it).
      const from = date === today ? Math.max(window.startMinute, nowMinute) : window.startMinute;
      const to = date === deadlineDate ? Math.min(window.endMinute, deadlineMinute) : window.endMinute;
      if (to > from) dayMinutes += to - from;
    }

    total += options.dailyCapacityMinutes != null ? Math.min(dayMinutes, options.dailyCapacityMinutes) : dayMinutes;
  }

  return total;
}

/**
 * Whether the remaining work still fits in the time genuinely left before the deadline.
 *
 * - `overdue`   — the deadline has passed and work remains
 * - `at-risk`   — there is less available time than the work needs; this cannot be finished on time
 * - `tight`     — it fits, but with less slack than `DEADLINE_COMFORT_FACTOR` allows for
 * - `comfortable` — it fits with room to spare (also the status when no work remains)
 */
export type DeadlineRiskLevel = "overdue" | "at-risk" | "tight" | "comfortable";

export interface DeadlineCapacity {
  workItemId: string;
  /** The exact deadline this was measured against, normalized to "YYYY-MM-DDTHH:mm". */
  deadline: string;
  /** Raw wall-clock minutes until the deadline — kept for display/explanation, never used as capacity. */
  minutesUntilDeadline: number;
  /** Usable work minutes before the deadline, per `calculateAvailableMinutesBeforeDeadline`. */
  availableMinutes: number;
  /** Estimated work still remaining on the item. */
  estimatedMinutes: number;
  /** availableMinutes - estimatedMinutes; negative means there genuinely isn't enough time. */
  bufferMinutes: number;
  risk: DeadlineRiskLevel;
  /** True when the deadline is within `IMMINENT_DEADLINE_HOURS` — drives wording, not scoring. */
  imminent: boolean;
}

export function calculateDeadlineCapacity(
  workItemId: string,
  deadline: string,
  estimatedMinutes: number,
  now: string,
  profile: PlanningProfile,
  commitments: Commitment[],
  existingBlocks: ScheduleBlock[],
  options: AvailableTimeOptions = {}
): DeadlineCapacity {
  const deadlineIso = normalizeDeadline(deadline);
  const minutesUntilDeadline = minutesUntil(now, deadlineIso);
  const availableMinutes = calculateAvailableMinutesBeforeDeadline(
    deadlineIso,
    now,
    profile,
    commitments,
    existingBlocks,
    options
  );

  return {
    workItemId,
    deadline: deadlineIso,
    minutesUntilDeadline,
    availableMinutes,
    estimatedMinutes,
    bufferMinutes: availableMinutes - estimatedMinutes,
    risk: assessRisk(estimatedMinutes, availableMinutes, minutesUntilDeadline),
    imminent: minutesUntilDeadline > 0 && minutesUntilDeadline <= IMMINENT_DEADLINE_HOURS * 60,
  };
}

function assessRisk(estimatedMinutes: number, availableMinutes: number, minutesUntilDeadline: number): DeadlineRiskLevel {
  if (estimatedMinutes <= 0) return "comfortable";
  if (minutesUntilDeadline <= 0) return "overdue";
  if (availableMinutes < estimatedMinutes) return "at-risk";
  if (availableMinutes < estimatedMinutes * DEADLINE_COMFORT_FACTOR) return "tight";
  return "comfortable";
}

/**
 * Turns the same demand/availability numbers `detectOverload` computes into a single reusable
 * status a student can glance at (Phase 3A, Part 6): ahead / on-track / getting-tight / at-risk.
 * Grounded in real numbers, never a vague feeling — the message always names the actual minutes
 * behind the verdict, e.g. "you have 7h 20m of work remaining but only 4h 30m of available time".
 */
import {
  WORKLOAD_STATUS_GETTING_TIGHT_MAX_RATIO,
  WORKLOAD_STATUS_ON_TRACK_MAX_RATIO,
} from "./constants";
import { formatMinutesAsHoursMinutes } from "./date-utils";
import type { SchedulableWorkItem, WorkloadStatus } from "./types";

export function calculateWorkloadStatus(
  entries: { item: SchedulableWorkItem; remainingMinutes: number }[],
  totalAvailableMinutes: number,
  hasUnscheduledHardDeadline: boolean
): WorkloadStatus {
  const estimatedRemainingMinutes = entries.reduce((sum, e) => sum + e.remainingMinutes, 0);
  const bufferMinutes = totalAvailableMinutes - estimatedRemainingMinutes;

  if (estimatedRemainingMinutes === 0) {
    return {
      level: "ahead",
      message: "You're ahead — there's no estimated work left to place in this range.",
      estimatedRemainingMinutes,
      availableMinutes: totalAvailableMinutes,
      bufferMinutes,
    };
  }

  const ratio = estimatedRemainingMinutes / Math.max(1, totalAvailableMinutes);
  const remainingLabel = formatMinutesAsHoursMinutes(estimatedRemainingMinutes);
  const availableLabel = formatMinutesAsHoursMinutes(totalAvailableMinutes);

  if (hasUnscheduledHardDeadline || ratio > WORKLOAD_STATUS_GETTING_TIGHT_MAX_RATIO) {
    return {
      level: "at-risk",
      message: hasUnscheduledHardDeadline
        ? `You're at risk — a hard or important deadline couldn't be fully scheduled. You have about ${remainingLabel} of work remaining but only about ${availableLabel} of available time.`
        : `You're at risk because you have about ${remainingLabel} of work remaining but only about ${availableLabel} of available time.`,
      estimatedRemainingMinutes,
      availableMinutes: totalAvailableMinutes,
      bufferMinutes,
    };
  }

  if (ratio > WORKLOAD_STATUS_ON_TRACK_MAX_RATIO) {
    return {
      level: "getting-tight",
      message: `It's getting tight — about ${remainingLabel} of work remaining against about ${availableLabel} of available time, leaving only a small buffer.`,
      estimatedRemainingMinutes,
      availableMinutes: totalAvailableMinutes,
      bufferMinutes,
    };
  }

  return {
    level: "on-track",
    message: `You're on track — about ${remainingLabel} of work remaining with about ${availableLabel} of available time.`,
    estimatedRemainingMinutes,
    availableMinutes: totalAvailableMinutes,
    bufferMinutes,
  };
}

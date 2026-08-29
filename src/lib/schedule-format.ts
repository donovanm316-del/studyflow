import type { ScheduleBlock, WorkStage } from "@/types/models";
import type { ScheduleBlockCardProps } from "@/components/schedule/ScheduleBlockCard";
import type { NewWorkItemInput } from "@/lib/data/store";
import { daysBetweenDateOnly, formatClockTime, normalizeDeadline, weekdayName } from "@/scheduling-engine";
import type { SchedulableWorkItem } from "@/scheduling-engine";

export function blockCardKind(block: ScheduleBlock): ScheduleBlockCardProps["kind"] {
  if (block.origin === "break") return "break";
  if (block.origin === "commitment") return "commitment";
  return block.workItemKind ?? "assignment";
}

export function formatTimeRange(block: ScheduleBlock): string {
  return `${formatClockTime(block.start)} – ${formatClockTime(block.end)}`;
}

/**
 * A deadline label carrying the exact time, since Phase 4.5A deadlines are real timestamps:
 * "Due today at 11:59 PM", "Due tomorrow at 3:00 PM", "Due Monday at 8:00 AM",
 * "Due in 4 days at 11:59 PM", "Overdue · was due yesterday at 11:59 PM".
 *
 * The time is always shown for a deadline that's near (today/tomorrow/overdue) or on a named
 * weekday, because that's when it changes what a student should do. Beyond a week out the phrasing
 * stays coarse ("Due in 9 days") — precision that far ahead is noise, not context.
 */
export function formatDueLabel(dueDateIso: string, todayDateOnly: string): string {
  const normalized = normalizeDeadline(dueDateIso);
  const dueDateOnly = normalized.slice(0, 10);
  const time = formatClockTime(normalized);

  const diffDays = daysBetweenDateOnly(todayDateOnly, dueDateOnly);

  if (diffDays < 0) {
    if (diffDays === -1) return `Overdue · was due yesterday at ${time}`;
    return `Overdue · was due ${Math.abs(diffDays)} days ago at ${time}`;
  }
  if (diffDays === 0) return `Due today at ${time}`;
  if (diffDays === 1) return `Due tomorrow at ${time}`;
  if (diffDays <= 6) return `Due ${weekdayName(dueDateOnly)} at ${time}`;
  return `Due in ${diffDays} days`;
}

/**
 * True if `block` is scheduled time for `workItemId` — directly, or (Phase 4) via one of that
 * item's decomposed stages, whose id is what actually ends up on the block's `workItemId`. Pages
 * that count/find a work item's blocks (Dashboard, Assignments, Tests) use this instead of a bare
 * `===` so a decomposed project's session counts don't silently read as zero.
 */
export function blockMatchesWorkItem(block: ScheduleBlock, workItemId: string, stages: WorkStage[]): boolean {
  if (!block.workItemId) return false;
  if (block.workItemId === workItemId) return true;
  const stage = stages.find((s) => s.id === block.workItemId);
  return stage?.workItemId === workItemId;
}

/** Fields the scheduler actually reacts to — used to decide whether an edit deserves the
 *  "your schedule was updated" notice (Phase 3B, Part 8/9), not every cosmetic change. */
export function changesSchedule(before: SchedulableWorkItem, after: NewWorkItemInput): boolean {
  return (
    // Normalized so a legacy date-only value vs. its "T23:59" equivalent isn't reported as a
    // change, while a genuine time edit (11:59 PM → 9:00 AM) correctly is.
    normalizeDeadline(before.dueDate) !== normalizeDeadline(after.dueDate) ||
    before.estimatedMinutes !== after.estimatedMinutes ||
    before.weight !== after.weight ||
    before.deadlineStrictness !== after.deadlineStrictness ||
    (before.preferredStartDate ?? "") !== (after.preferredStartDate ?? "")
  );
}

import type { ScheduleBlock } from "@/types/models";
import type { ScheduleBlockCardProps } from "@/components/schedule/ScheduleBlockCard";
import type { NewWorkItemInput } from "@/lib/data/store";
import type { SchedulableWorkItem } from "@/scheduling-engine";

export function blockCardKind(block: ScheduleBlock): ScheduleBlockCardProps["kind"] {
  if (block.origin === "break") return "break";
  if (block.origin === "commitment") return "commitment";
  return block.workItemKind ?? "assignment";
}

function formatClockTime(isoDateTime: string): string {
  const timePart = isoDateTime.split("T")[1] ?? "00:00";
  const [h, m] = timePart.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

export function formatTimeRange(block: ScheduleBlock): string {
  return `${formatClockTime(block.start)} – ${formatClockTime(block.end)}`;
}

export function formatDueLabel(dueDateIso: string, todayDateOnly: string): string {
  const dueDateOnly = dueDateIso.slice(0, 10);
  if (dueDateOnly < todayDateOnly) return "Overdue";
  if (dueDateOnly === todayDateOnly) return "Due today";

  const diffDays = Math.round(
    (dateOnlyToUtcMs(dueDateOnly) - dateOnlyToUtcMs(todayDateOnly)) / 86_400_000
  );
  if (diffDays === 1) return "Due tomorrow";
  return `Due in ${diffDays} days`;
}

function dateOnlyToUtcMs(dateOnly: string): number {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Fields the scheduler actually reacts to — used to decide whether an edit deserves the
 *  "your schedule was updated" notice (Phase 3B, Part 8/9), not every cosmetic change. */
export function changesSchedule(before: SchedulableWorkItem, after: NewWorkItemInput): boolean {
  return (
    before.dueDate !== after.dueDate ||
    before.estimatedMinutes !== after.estimatedMinutes ||
    before.weight !== after.weight ||
    before.deadlineStrictness !== after.deadlineStrictness ||
    (before.preferredStartDate ?? "") !== (after.preferredStartDate ?? "")
  );
}

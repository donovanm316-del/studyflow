/**
 * Compares two `ScheduleBlock[]` snapshots and reports only the work items whose schedule
 * footprint actually changed (Phase 3B, Part 6/7). Deliberately approximate, not a full
 * version-control diff: work is grouped per work item (across all its session parts) and
 * compared by total minutes and earliest date, which is enough to say "this moved" or "this got
 * shorter" without tracking every individual chunk.
 */
import { blockDurationMinutes, formatMinutesAsHoursMinutes, toDateOnly } from "./date-utils";
import type { ScheduleBlock } from "@/types/models";
import type { ScheduleChangeSummary, WorkItemScheduleChange } from "./types";

interface ItemFootprint {
  title: string;
  totalMinutes: number;
  earliestDate: string;
}

function footprintsByItem(blocks: ScheduleBlock[]): Map<string, ItemFootprint> {
  const map = new Map<string, ItemFootprint>();
  for (const block of blocks) {
    if (!block.workItemId || block.status === "skipped") continue;
    // Session titles carry a "(part N)" suffix for multi-session items — strip it so the same
    // item's parts aggregate under one clean title.
    const title = block.title.replace(/\s*\(part \d+\)\s*$/, "");
    const duration = blockDurationMinutes(block.start, block.end);
    const date = toDateOnly(block.start);
    const existing = map.get(block.workItemId);
    if (!existing) {
      map.set(block.workItemId, { title, totalMinutes: duration, earliestDate: date });
    } else {
      existing.totalMinutes += duration;
      if (date < existing.earliestDate) existing.earliestDate = date;
    }
  }
  return map;
}

function summarize(footprint: ItemFootprint): string {
  return `${formatDayLabel(footprint.earliestDate)}, ${formatMinutesAsHoursMinutes(footprint.totalMinutes)}`;
}

function formatDayLabel(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[new Date(y, m - 1, d).getDay()];
}

export function diffSchedules(before: ScheduleBlock[], after: ScheduleBlock[]): ScheduleChangeSummary {
  const beforeMap = footprintsByItem(before);
  const afterMap = footprintsByItem(after);
  const allIds = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  const changes: WorkItemScheduleChange[] = [];
  for (const id of allIds) {
    const prev = beforeMap.get(id);
    const next = afterMap.get(id);

    if (!prev && next) {
      changes.push({ workItemId: id, title: next.title, kind: "added", after: summarize(next) });
    } else if (prev && !next) {
      changes.push({ workItemId: id, title: prev.title, kind: "removed", before: summarize(prev) });
    } else if (prev && next) {
      if (prev.earliestDate !== next.earliestDate) {
        changes.push({ workItemId: id, title: next.title, kind: "moved", before: summarize(prev), after: summarize(next) });
      } else if (prev.totalMinutes !== next.totalMinutes) {
        changes.push({ workItemId: id, title: next.title, kind: "duration-changed", before: summarize(prev), after: summarize(next) });
      }
    }
  }

  return { changes };
}

/**
 * Turns a Planning Profile + fixed Commitments + already-placed blocks into the free time
 * windows actually usable for scheduling work on a given day (Part 6 / Part 7).
 *
 * Limitation (documented, not silently assumed away): availability is only as good as
 * `PlanningProfile.dailyAvailability`. There is no separate sleep/protected-time model in
 * Phase 2 — a day with no `dailyAvailability` entry, or a narrow earliest/latest window, is how
 * a student keeps time protected. If a day has no entry at all, it is treated as fully unavailable.
 */
import { MIN_CHUNK_MINUTES } from "./constants";
import { dayOfWeekOf, minutesOfDay, toDateOnly } from "./date-utils";
import type { Commitment, PlanningProfile, ScheduleBlock } from "@/types/models";

export interface TimeWindow {
  startMinute: number;
  endMinute: number;
}

export function findAvailableWindows(
  dateOnly: string,
  profile: PlanningProfile,
  commitments: Commitment[],
  existingBlocks: ScheduleBlock[]
): TimeWindow[] {
  const dow = dayOfWeekOf(dateOnly);
  const availability = profile.dailyAvailability.find((a) => a.dayOfWeek === dow);
  if (!availability) return [];

  const dayWindow: TimeWindow = {
    startMinute: minutesOfDay(availability.earliest),
    endMinute: minutesOfDay(availability.latest),
  };
  if (dayWindow.endMinute <= dayWindow.startMinute) return [];

  const busy: TimeWindow[] = [
    ...commitmentIntervalsFor(dateOnly, dow, commitments),
    ...blockIntervalsFor(dateOnly, existingBlocks),
  ];

  return subtractIntervals(dayWindow, busy).filter(
    (w) => w.endMinute - w.startMinute >= MIN_CHUNK_MINUTES
  );
}

function commitmentIntervalsFor(dateOnly: string, dow: number, commitments: Commitment[]): TimeWindow[] {
  const intervals: TimeWindow[] = [];
  for (const c of commitments) {
    const applies =
      c.recurrence.type === "weekly"
        ? c.recurrence.daysOfWeek.includes(dow)
        : c.recurrence.date === dateOnly;
    if (!applies) continue;
    intervals.push({
      startMinute: minutesOfDayFromTimeValue(c.startTime),
      endMinute: minutesOfDayFromTimeValue(c.endTime),
    });
  }
  return intervals;
}

function blockIntervalsFor(dateOnly: string, blocks: ScheduleBlock[]): TimeWindow[] {
  return blocks
    .filter((b) => b.status !== "skipped" && toDateOnly(b.start) === dateOnly)
    .map((b) => ({
      startMinute: minutesOfDayFromTimeValue(b.start),
      endMinute: minutesOfDayFromTimeValue(b.end),
    }));
}

/** Accepts either a plain "HH:mm" or a combined "YYYY-MM-DDTHH:mm" value. */
function minutesOfDayFromTimeValue(value: string): number {
  const timePart = value.includes("T") ? value.split("T")[1] : value;
  return minutesOfDay(timePart);
}

/** Subtracts a set of busy intervals from a single window, returning the remaining free windows. */
export function subtractIntervals(window: TimeWindow, busy: TimeWindow[]): TimeWindow[] {
  const sorted = [...busy]
    .filter((b) => b.endMinute > window.startMinute && b.startMinute < window.endMinute)
    .map((b) => ({
      startMinute: Math.max(b.startMinute, window.startMinute),
      endMinute: Math.min(b.endMinute, window.endMinute),
    }))
    .sort((a, b) => a.startMinute - b.startMinute);

  const merged: TimeWindow[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, interval.endMinute);
    } else {
      merged.push({ ...interval });
    }
  }

  const free: TimeWindow[] = [];
  let cursor = window.startMinute;
  for (const busyInterval of merged) {
    if (busyInterval.startMinute > cursor) {
      free.push({ startMinute: cursor, endMinute: busyInterval.startMinute });
    }
    cursor = Math.max(cursor, busyInterval.endMinute);
  }
  if (cursor < window.endMinute) {
    free.push({ startMinute: cursor, endMinute: window.endMinute });
  }
  return free;
}

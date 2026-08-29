/**
 * Small, dependency-free date/time helpers shared across the scheduling engine.
 * Dates are plain "YYYY-MM-DD" strings; times of day are "HH:mm"; combined values are
 * "YYYY-MM-DD"T"HH:mm" — all interpreted as local wall-clock time, with no timezone
 * conversion. This matches how `dueDate`/`start`/`end` are documented in `types/models.ts`.
 */

export function toDateOnly(isoDateTime: string): string {
  return isoDateTime.slice(0, 10);
}

/** 0 = Sunday .. 6 = Saturday, computed without timezone shifting. */
export function dayOfWeekOf(dateOnly: string): number {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function hhmmOf(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const m = Math.floor(totalMinutes % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}`;
}

export function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return dateOnlyOf(date);
}

export function dateOnlyOf(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Inclusive list of "YYYY-MM-DD" dates from start to end. */
export function dateRange(startDateOnly: string, endDateOnly: string): string[] {
  const dates: string[] = [];
  let cur = startDateOnly;
  let guard = 0;
  while (cur <= endDateOnly && guard < 3650) {
    dates.push(cur);
    cur = addDays(cur, 1);
    guard += 1;
  }
  return dates;
}

export function combineDateAndMinutes(dateOnly: string, totalMinutes: number): string {
  return `${dateOnly}T${hhmmOf(totalMinutes)}`;
}

/** Fractional days between two ISO date-times (positive if `to` is after `from`). */
export function diffInDays(fromIso: string, toIso: string): number {
  return (parseLocal(toIso).getTime() - parseLocal(fromIso).getTime()) / 86_400_000;
}

/** Parses "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm[:ss]" as local time (never UTC). */
export function parseLocal(isoLike: string): Date {
  const [datePart, timePart] = isoLike.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  if (!timePart) return new Date(y, m - 1, d);
  const [h, min] = timePart.split(":").map(Number);
  return new Date(y, m - 1, d, h, min);
}

/** "7h 20m" / "2h" / "45m" / "0m" — the human-readable duration format used across Phase 3A UI. */
export function formatMinutesAsHoursMinutes(totalMinutes: number): string {
  const rounded = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Duration in minutes between two "HH:mm" (or "...THH:mm") time values on the same day. */
export function blockDurationMinutes(startIso: string, endIso: string): number {
  const start = minutesOfDay(startIso.split("T")[1] ?? startIso);
  const end = minutesOfDay(endIso.split("T")[1] ?? endIso);
  return end - start;
}

/**
 * The end of the day, used as the implied deadline time whenever one isn't specified — both for
 * legacy date-only data and for the "Due date" field's default (Phase 4.5A, Part 2/3).
 */
export const DEFAULT_DEADLINE_TIME = "23:59";

/**
 * Coerces any stored deadline into a full "YYYY-MM-DDTHH:mm" timestamp (Phase 4.5A, Part 1/2).
 *
 * Pre-4.5A data may hold a bare "YYYY-MM-DD" (or a value with seconds, e.g. from the test
 * fixtures). A date with no time is interpreted as 11:59 PM local — the end of the day it was
 * due, which is what a student means by "due Friday" — never midnight, which would silently make
 * the item a full day more urgent than intended. Idempotent: a value that already carries a time
 * is returned with just its seconds trimmed, so this is safe to call defensively anywhere.
 */
export function normalizeDeadline(dueDate: string): string {
  const [datePart, timePart] = dueDate.split("T");
  if (!timePart) return `${datePart}T${DEFAULT_DEADLINE_TIME}`;
  const [h, m] = timePart.split(":");
  return `${datePart}T${h}:${m}`;
}

/** Minutes from `fromIso` until `toIso` — negative once `toIso` is in the past. Time-aware. */
export function minutesUntil(fromIso: string, toIso: string): number {
  return (parseLocal(toIso).getTime() - parseLocal(fromIso).getTime()) / 60_000;
}

/** Hours from `fromIso` until `toIso` — negative once `toIso` is in the past. Time-aware. */
export function hoursUntil(fromIso: string, toIso: string): number {
  return minutesUntil(fromIso, toIso) / 60;
}

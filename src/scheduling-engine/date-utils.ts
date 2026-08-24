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

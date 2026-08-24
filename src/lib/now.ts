/** Formats a Date as the local "YYYY-MM-DDTHH:mm" string the scheduling engine expects. */
export function nowLocalIso(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  const h = date.getHours().toString().padStart(2, "0");
  const min = date.getMinutes().toString().padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

export function todayDateOnly(date: Date = new Date()): string {
  return nowLocalIso(date).slice(0, 10);
}

/**
 * A rolling 7-day planning window starting today (not a Mon–Sun calendar week). This keeps
 * "today" as the first day shown no matter what day of the week it is — a calendar-aligned week
 * would otherwise make anything due "tomorrow" disappear entirely whenever today is a Sunday.
 */
export function currentWeekRange(date: Date = new Date()): { start: string; end: string } {
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 6);
  return { start: todayDateOnly(date), end: todayDateOnly(end) };
}


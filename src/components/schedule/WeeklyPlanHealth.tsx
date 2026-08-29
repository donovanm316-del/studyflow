"use client";

import { formatMinutesAsHoursMinutes } from "@/scheduling-engine";
import type { DayHealth, WeekSummary } from "@/lib/decision-support";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayLabel(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return DAY_LABELS[new Date(y, m - 1, d).getDay()];
}

const STATUS_LABEL: Record<DayHealth["status"], string> = {
  light: "Light",
  comfortable: "Comfortable",
  "getting-tight": "Getting tight",
  "over-capacity": "Over capacity",
};

const STATUS_ICON: Record<DayHealth["status"], string> = {
  light: "·",
  comfortable: "✓",
  "getting-tight": "!",
  "over-capacity": "▲",
};

const STATUS_TONE: Record<DayHealth["status"], string> = {
  light: "text-ink-faint",
  comfortable: "text-success",
  "getting-tight": "text-warning",
  "over-capacity": "text-danger",
};

/**
 * Per-day plan health plus a plain-language read on the week (Phase 4.5B, Part 9/10). Every figure
 * comes from the engine's own `dailyForecast` and `workloadStatus` — nothing here is projected
 * independently. Status is shown as text + icon, never color alone.
 */
export function WeeklyPlanHealth({ days, summary, today }: { days: DayHealth[]; summary: WeekSummary; today: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-ink">{summary.headline}</p>
      <p className="mt-1 text-sm text-ink-muted">{summary.detail}</p>

      <ul className="mt-4 flex flex-col divide-y divide-border">
        {days.map((day) => (
          <li key={day.date} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
            <span className={`text-sm font-medium ${day.date === today ? "text-brand" : "text-ink"}`}>
              {dayLabel(day.date)}
              {day.date === today && <span className="ml-1 text-xs font-normal text-ink-faint">(today)</span>}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 text-xs text-ink-muted">
              <span>{formatMinutesAsHoursMinutes(day.workMinutes)} planned</span>
              <span>{formatMinutesAsHoursMinutes(day.availableMinutes)} available</span>
              <span className={day.bufferMinutes < 0 ? "text-danger" : undefined}>
                {day.bufferMinutes < 0
                  ? `${formatMinutesAsHoursMinutes(Math.abs(day.bufferMinutes))} over`
                  : `${formatMinutesAsHoursMinutes(day.bufferMinutes)} buffer`}
              </span>
              <span className={`font-medium ${STATUS_TONE[day.status]}`}>
                <span aria-hidden>{STATUS_ICON[day.status]}</span> {STATUS_LABEL[day.status]}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

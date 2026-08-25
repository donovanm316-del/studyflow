import { formatMinutesAsHoursMinutes, type DailyForecastEntry } from "@/scheduling-engine";
import { EmptyState } from "@/components/ui/EmptyState";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayLabel(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return DAY_LABELS[new Date(y, m - 1, d).getDay()];
}

/**
 * A 7-ish-day workload forecast (Phase 3A, Part 8), built entirely from the scheduling engine's
 * own `dailyForecast` output — never fabricated in the UI. Each bar overlays projected work
 * minutes on top of that day's available minutes so over-capacity days are visually obvious.
 */
export function WorkloadForecast({ forecast, today }: { forecast: DailyForecastEntry[]; today: string }) {
  const totalWork = forecast.reduce((sum, d) => sum + d.workMinutes, 0);

  if (totalWork === 0) {
    return <EmptyState title="Nothing projected" description="No estimated work falls in this range right now." />;
  }

  const totalAvailable = forecast.reduce((sum, d) => sum + d.availableMinutes, 0);
  const buffer = totalAvailable - totalWork;
  const maxScale = Math.max(1, ...forecast.map((d) => Math.max(d.workMinutes, d.availableMinutes)));
  const heaviest = forecast.reduce((max, d) => (d.workMinutes > max.workMinutes ? d : max), forecast[0]);

  return (
    <div>
      <div className="flex items-end justify-between gap-2 sm:gap-3">
        {forecast.map((d) => {
          const overCapacity = d.workMinutes > d.availableMinutes;
          const availablePct = Math.min(100, (d.availableMinutes / maxScale) * 100);
          const workPct = Math.min(100, (d.workMinutes / maxScale) * 100);
          return (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="relative h-24 w-full max-w-10 rounded-sm bg-paper" title={`${formatMinutesAsHoursMinutes(d.workMinutes)} of ${formatMinutesAsHoursMinutes(d.availableMinutes)} available`}>
                <div className="absolute bottom-0 w-full rounded-sm bg-border" style={{ height: `${availablePct}%` }} />
                <div
                  className={`absolute bottom-0 w-full rounded-sm ${overCapacity ? "bg-danger" : "bg-brand"}`}
                  style={{ height: `${workPct}%` }}
                />
              </div>
              <span className={`text-xs font-medium ${d.date === today ? "text-brand" : "text-ink-muted"}`}>
                {dayLabel(d.date)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
        <span>Estimated work: <span className="font-medium text-ink">{formatMinutesAsHoursMinutes(totalWork)}</span></span>
        <span>Available time: <span className="font-medium text-ink">{formatMinutesAsHoursMinutes(totalAvailable)}</span></span>
        <span>
          Buffer:{" "}
          <span className={`font-medium ${buffer < 0 ? "text-danger" : "text-ink"}`}>
            {buffer < 0 ? "-" : ""}
            {formatMinutesAsHoursMinutes(Math.abs(buffer))}
          </span>
        </span>
      </div>

      {heaviest.workMinutes > 0 && (
        <p className="mt-2 text-xs text-ink-faint">{dayLabel(heaviest.date)} is currently your heaviest day.</p>
      )}
    </div>
  );
}

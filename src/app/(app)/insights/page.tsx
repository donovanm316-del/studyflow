"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useAppData } from "@/lib/data/store";

export default function InsightsPage() {
  const { workSessions } = useAppData();

  if (workSessions.length === 0) {
    return (
      <div>
        <PageHeader title="Insights" description="Patterns in your planning and workload over time." />
        <EmptyState
          title="Not enough data yet"
          description="Insights build up as you complete or postpone scheduled work sessions on the Today page. Come back once you've worked through a few."
        />
      </div>
    );
  }

  const completed = workSessions.filter((s) => s.minutesSpent != null);
  const postponed = workSessions.filter((s) => s.postponed);
  const completionRate = Math.round((completed.length / workSessions.length) * 100);

  const withEstimates = completed.filter((s) => s.plannedMinutes != null);
  const avgDiffMinutes =
    withEstimates.length > 0
      ? Math.round(
          withEstimates.reduce((sum, s) => sum + ((s.minutesSpent ?? 0) - (s.plannedMinutes ?? 0)), 0) / withEstimates.length
        )
      : null;

  return (
    <div>
      <PageHeader title="Insights" description="Patterns in your planning and workload over time." />

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Schedule completion</h2>
          <ProgressBar value={completionRate} label={`${completed.length} of ${workSessions.length} sessions completed`} tone="brand" />
          <p className="mt-2 text-xs text-ink-muted">{postponed.length} session(s) postponed or skipped.</p>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Estimate accuracy</h2>
          {avgDiffMinutes === null ? (
            <p className="text-sm text-ink-muted">Not enough completed sessions with a planned duration yet.</p>
          ) : (
            <p className="text-sm text-ink">
              On average, completed sessions ran{" "}
              <span className="font-medium">
                {avgDiffMinutes === 0 ? "right on estimate" : `${Math.abs(avgDiffMinutes)} minutes ${avgDiffMinutes > 0 ? "longer" : "shorter"} than planned`}
              </span>
              .
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

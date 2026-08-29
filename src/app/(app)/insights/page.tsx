"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useAppData } from "@/lib/data/store";
import {
  DAY_NAMES,
  MIN_SESSIONS_FOR_CATEGORY_INSIGHT,
  calculateAccuracyByWorkType,
  calculateAverageWeeklyWorkloadMinutes,
  calculateBusiestDayOfWeek,
  calculateEstimateAccuracy,
  calculateFeedbackTally,
  calculatePostponementRate,
  calculateTypicalWorkWindow,
  formatHourLabel,
} from "@/lib/insights";

export default function InsightsPage() {
  const { workSessions, feedback, workItems, stages } = useAppData();

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
  const completionRate = Math.round((completed.length / workSessions.length) * 100);

  const estimateAccuracy = calculateEstimateAccuracy(workSessions);
  const typicalWindow = calculateTypicalWorkWindow(workSessions);
  const postponement = calculatePostponementRate(workSessions);
  const busiestDay = calculateBusiestDayOfWeek(workSessions);
  const avgWeeklyMinutes = calculateAverageWeeklyWorkloadMinutes(workSessions);
  const feedbackTally = calculateFeedbackTally(feedback);
  const categoryAccuracy = calculateAccuracyByWorkType(workSessions, workItems, stages);

  return (
    <div>
      <PageHeader title="Insights" description="Patterns in your planning and workload over time." />

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Schedule completion</h2>
          <ProgressBar value={completionRate} label={`${completed.length} of ${workSessions.length} sessions completed`} tone="brand" />
          {postponement && <p className="mt-2 text-xs text-ink-muted">{postponement.ratePercent}% of sessions ({postponement.postponedCount}) were postponed or skipped.</p>}
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Estimate accuracy</h2>
          {estimateAccuracy === null ? (
            <p className="text-sm text-ink-muted">Not enough completed sessions with a planned duration yet.</p>
          ) : (
            <div className="text-sm text-ink">
              <p>
                Based on {estimateAccuracy.sessionCount} completed session{estimateAccuracy.sessionCount === 1 ? "" : "s"}: averaged{" "}
                <span className="font-medium">{estimateAccuracy.avgEstimatedMinutes} min</span> estimated vs.{" "}
                <span className="font-medium">{estimateAccuracy.avgActualMinutes} min</span> actual.
              </p>
              <p className="mt-1 text-ink-muted">
                {estimateAccuracy.avgDiffMinutes === 0
                  ? "On average, right on estimate."
                  : `On average, ${Math.abs(estimateAccuracy.avgDiffMinutes)} minutes ${estimateAccuracy.avgDiffMinutes > 0 ? "longer" : "shorter"} than planned.`}
              </p>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Work habits</h2>
          {typicalWindow === null ? (
            <p className="text-sm text-ink-muted">Not enough completed sessions yet to spot a pattern.</p>
          ) : (
            <p className="text-sm text-ink">
              Based on {typicalWindow.sessionCount} completed sessions, most of your recorded work has occurred between{" "}
              <span className="font-medium">{formatHourLabel(typicalWindow.startHour)}</span> and{" "}
              <span className="font-medium">{formatHourLabel(typicalWindow.endHour)}</span>.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Workload</h2>
          {avgWeeklyMinutes === null && busiestDay === null ? (
            <p className="text-sm text-ink-muted">Not enough data yet to summarize a typical week.</p>
          ) : (
            <div className="flex flex-col gap-1 text-sm text-ink">
              {avgWeeklyMinutes !== null && (
                <p>
                  Average weekly workload: <span className="font-medium">{Math.round(avgWeeklyMinutes / 60 * 10) / 10}h</span>
                </p>
              )}
              {busiestDay !== null && (
                <p>
                  Busiest day so far: <span className="font-medium">{DAY_NAMES[busiestDay.dayOfWeek]}</span>
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-1 text-sm font-semibold text-ink">Estimating by type of work</h2>
        <p className="mb-3 text-xs text-ink-faint">
          Where your estimates tend to be off. StudyFlow uses this to adjust how long it plans for similar work.
        </p>
        {categoryAccuracy.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Not enough information yet. This fills in once you&apos;ve completed at least{" "}
            {MIN_SESSIONS_FOR_CATEGORY_INSIGHT} sessions of the same kind of work — until then any pattern here
            would just be noise.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {categoryAccuracy.map((c) => (
              <li key={c.workType} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                <span className="text-sm text-ink">{c.label}</span>
                <span className="flex items-center gap-3 text-xs text-ink-muted">
                  <span>
                    {c.percentDifference === 0 ? (
                      <span className="font-medium text-success">usually close to your estimate</span>
                    ) : (
                      <>
                        usually{" "}
                        <span className={`font-medium ${c.percentDifference > 0 ? "text-warning" : "text-success"}`}>
                          {Math.abs(c.percentDifference)}% {c.percentDifference > 0 ? "longer" : "shorter"}
                        </span>{" "}
                        than estimated
                      </>
                    )}
                  </span>
                  <span className="text-ink-faint">{c.sessionCount} sessions</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {feedbackTally && (
        <section className="mt-6 rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Scheduling behavior</h2>
          <p className="text-sm text-ink">
            Of {feedbackTally.total} weekly check-in{feedbackTally.total === 1 ? "" : "s"}: rated{" "}
            <span className="font-medium">{feedbackTally.tooHeavy}</span> too heavy,{" "}
            <span className="font-medium">{feedbackTally.justRight}</span> just right, and{" "}
            <span className="font-medium">{feedbackTally.tooLight}</span> too light.
          </p>
        </section>
      )}
    </div>
  );
}

"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { TaskRow } from "@/components/tasks/TaskRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAppData } from "@/lib/data/store";
import { useSchedule } from "@/lib/data/useSchedule";
import { formatDueLabel } from "@/lib/schedule-format";
import { currentWeekRange, todayDateOnly } from "@/lib/now";

const KIND_LABEL: Record<string, string> = { assignment: "Assignment", test: "Test", quiz: "Quiz", project: "Project" };

export default function DashboardPage() {
  const { workItems, workSessions } = useAppData();
  const { start, end } = currentWeekRange();
  const today = todayDateOnly();
  const result = useSchedule(start, end);

  const dueThisWeek = workItems.filter((item) => item.dueDate.slice(0, 10) >= start && item.dueDate.slice(0, 10) <= end);
  const completedThisWeek = dueThisWeek.filter((item) => item.status === "completed").length;
  const completionPercent = dueThisWeek.length > 0 ? Math.round((completedThisWeek / dueThisWeek.length) * 100) : 0;

  const upcoming = workItems
    .filter((item) => item.status !== "completed")
    .sort((a, b) => (result.priorities[b.id]?.score ?? 0) - (result.priorities[a.id]?.score ?? 0))
    .slice(0, 5);

  const completedSessions = workSessions.filter((s) => s.minutesSpent != null && s.plannedMinutes != null);

  return (
    <div>
      <PageHeader title="Dashboard" description="A quick look at your workload and how the week is going." />

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">This week&apos;s workload</h2>
          {dueThisWeek.length === 0 ? (
            <EmptyState title="Nothing due this week" description="You're clear for the week." />
          ) : (
            <ProgressBar value={completionPercent} label={`${completedThisWeek} of ${dueThisWeek.length} due this week completed`} tone="brand" />
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Estimate accuracy</h2>
          {completedSessions.length === 0 ? (
            <EmptyState
              title="Not enough data yet"
              description="This fills in once you mark scheduled sessions complete on the Today page."
            />
          ) : (
            <p className="text-sm text-ink">
              Based on {completedSessions.length} completed session{completedSessions.length === 1 ? "" : "s"} — see the{" "}
              <span className="font-medium">Insights</span> page for the full breakdown.
            </p>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">Coming up</h2>
        {upcoming.length === 0 ? (
          <EmptyState title="You're all caught up" description="Nothing outstanding right now." />
        ) : (
          upcoming.map((item) => (
            <TaskRow
              key={item.id}
              title={item.title}
              subject={item.subject}
              dueLabel={formatDueLabel(item.dueDate, today)}
              status={item.status}
              kindLabel={KIND_LABEL[item.kind] ?? item.kind}
              estimatedMinutes={item.estimatedMinutes}
            />
          ))
        )}
      </section>
    </div>
  );
}

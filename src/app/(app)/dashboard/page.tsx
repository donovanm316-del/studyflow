"use client";

import { useMemo } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Button } from "@/components/ui/Button";
import { TaskRow } from "@/components/tasks/TaskRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { WorkloadStatusBadge } from "@/components/schedule/WorkloadStatusBadge";
import { NextUpCard } from "@/components/schedule/NextUpCard";
import { useAppData } from "@/lib/data/store";
import { useSchedule } from "@/lib/data/useSchedule";
import { blockMatchesWorkItem, formatDueLabel } from "@/lib/schedule-format";
import { currentWeekRange, todayDateOnly, nowLocalIso } from "@/lib/now";
import { getNextBestAction } from "@/lib/next-best-action";

const KIND_LABEL: Record<string, string> = { assignment: "Assignment", test: "Test", quiz: "Quiz", project: "Project" };

function addDaysToDateOnly(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}

export default function DashboardPage() {
  const { workItems, workSessions, stages, activeSession, startSession } = useAppData();
  const { start, end } = currentWeekRange();
  const today = todayDateOnly();
  const todaySoonCutoff = addDaysToDateOnly(today, 1); // "due soon" = due today or tomorrow
  const result = useSchedule(start, end);
  const nextAction = useMemo(() => getNextBestAction(result, activeSession, nowLocalIso()), [result, activeSession]);

  const dueThisWeek = workItems.filter((item) => item.dueDate.slice(0, 10) >= start && item.dueDate.slice(0, 10) <= end);
  const completedThisWeek = dueThisWeek.filter((item) => item.status === "completed").length;
  const completionPercent = dueThisWeek.length > 0 ? Math.round((completedThisWeek / dueThisWeek.length) * 100) : 0;

  const upcoming = workItems
    .filter((item) => item.status !== "completed")
    .sort((a, b) => (result.priorities[b.id]?.score ?? 0) - (result.priorities[a.id]?.score ?? 0))
    .slice(0, 5);

  const completedSessions = workSessions.filter((s) => s.minutesSpent != null && s.plannedMinutes != null);
  const todaysWorkBlocks = result.blocks.filter((b) => b.start.slice(0, 10) === today && b.workItemId && b.status === "planned");

  if (workItems.length === 0) {
    return (
      <div>
        <PageHeader title="Dashboard" description="A quick look at your workload and how the week is going." />
        <EmptyState
          title="Add your first assignment or test"
          description="Once you've added something with a due date, your dashboard will show today's workload, upcoming deadlines, and how the week is going."
          action={
            <div className="flex gap-2">
              <Link href="/assignments"><Button>Add an assignment</Button></Link>
              <Link href="/tests"><Button variant="secondary">Add a test or quiz</Button></Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Dashboard" description="A quick look at your workload and how the week is going." />

      <div className="mb-6">
        <WorkloadStatusBadge status={result.workloadStatus} />
      </div>

      {!activeSession && nextAction.kind === "scheduled" && (
        <div className="mb-6">
          <NextUpCard action={nextAction} onStart={() => startSession(nextAction.block)} compact />
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-3">
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Today</h2>
          {todaysWorkBlocks.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing scheduled today.</p>
          ) : (
            <p className="text-sm text-ink">
              {todaysWorkBlocks.length} session{todaysWorkBlocks.length === 1 ? "" : "s"} planned —{" "}
              <Link href="/today" className="font-medium text-brand hover:underline">view Today</Link>
            </p>
          )}
        </section>

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
              <Link href="/insights" className="font-medium text-brand hover:underline">Insights</Link> page for the full breakdown.
            </p>
          )}
        </section>
      </div>

      <section className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">Coming up</h2>
        {upcoming.length === 0 ? (
          <EmptyState title="You're all caught up" description="Nothing outstanding right now." />
        ) : (
          upcoming.map((item) => {
            const remainingMinutes = Math.max(0, item.estimatedMinutes - (item.actualMinutes ?? 0));
            const plannedSessionCount = result.blocks.filter(
              (b) => blockMatchesWorkItem(b, item.id, stages) && b.status === "planned"
            ).length;
            const dueSoon = item.dueDate.slice(0, 10) <= todaySoonCutoff;
            const urgent = dueSoon && (item.deadlineStrictness === "hard" || item.deadlineStrictness === "important");
            return (
              <TaskRow
                key={item.id}
                title={item.title}
                subject={item.subject}
                dueLabel={formatDueLabel(item.dueDate, today)}
                status={item.status}
                kindLabel={KIND_LABEL[item.kind] ?? item.kind}
                estimatedMinutes={item.estimatedMinutes}
                remainingMinutes={remainingMinutes}
                plannedSessionCount={plannedSessionCount}
                urgent={urgent}
              />
            );
          })
        )}
      </section>
    </div>
  );
}

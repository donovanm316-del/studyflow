import { PageHeader } from "@/components/layout/PageHeader";
import { SampleDataNote } from "@/components/layout/SampleDataNote";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { TaskRow } from "@/components/tasks/TaskRow";
import { EmptyState } from "@/components/ui/EmptyState";

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="A quick look at your workload and how the week is going."
      />

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">This week&apos;s workload</h2>
          <SampleDataNote />
          <ProgressBar value={40} label="Assignments completed" tone="brand" />
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink">Estimate accuracy</h2>
          <EmptyState
            title="Not enough data yet"
            description="This will fill in once the scheduling engine can compare estimated vs. actual time on completed work."
          />
        </section>
      </div>

      <section className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">Coming up</h2>
        <SampleDataNote />
        <TaskRow
          title="Read Ch. 12 — Cell Respiration"
          subject="Biology"
          dueLabel="Due tomorrow"
          status="not-started"
          kindLabel="Assignment"
          estimatedMinutes={30}
        />
        <TaskRow
          title="Unit 4 Test"
          subject="Algebra II"
          dueLabel="Due in 3 days"
          status="not-started"
          kindLabel="Test"
          estimatedMinutes={90}
        />
        <TaskRow
          title="Lab report draft"
          subject="Chemistry"
          dueLabel="Due in 5 days"
          status="in-progress"
          kindLabel="Project"
          estimatedMinutes={120}
        />
      </section>
    </div>
  );
}

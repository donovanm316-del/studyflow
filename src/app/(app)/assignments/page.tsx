"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { TaskRow } from "@/components/tasks/TaskRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddWorkItemModal } from "@/components/tasks/AddWorkItemModal";
import { useAppData } from "@/lib/data/store";
import { useSchedule } from "@/lib/data/useSchedule";
import { formatDueLabel } from "@/lib/schedule-format";
import { todayDateOnly } from "@/lib/now";

const KIND_LABEL: Record<string, string> = { assignment: "Assignment", project: "Project" };

function addDaysToDateOnly(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}

export default function AssignmentsPage() {
  const { workItems, addWorkItem, markWorkItemComplete, markWorkItemIncomplete } = useAppData();
  const [modalOpen, setModalOpen] = useState(false);
  const today = todayDateOnly();

  const assignments = workItems
    .filter((item) => item.kind === "assignment" || item.kind === "project")
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

  // Wide enough to cover every item's due date (Part 13's "sessions planned before deadline"
  // needs the real schedule up to then), capped so a far-off item can't blow up the range.
  const farthestDue = assignments.reduce((max, item) => (item.dueDate.slice(0, 10) > max ? item.dueDate.slice(0, 10) : max), today);
  const rangeEnd = farthestDue > addDaysToDateOnly(today, 60) ? addDaysToDateOnly(today, 60) : farthestDue > today ? farthestDue : addDaysToDateOnly(today, 7);
  const result = useSchedule(today, rangeEnd);

  return (
    <div>
      <PageHeader
        title="Assignments"
        description="Homework, readings, essays, and projects."
        action={<Button onClick={() => setModalOpen(true)}>Add assignment</Button>}
      />

      <section className="rounded-lg border border-border bg-surface p-5">
        {assignments.length === 0 ? (
          <EmptyState title="No assignments yet" description="Add your first assignment to see it here and in your schedule." />
        ) : (
          assignments.map((item) => {
            const remainingMinutes = Math.max(0, item.estimatedMinutes - (item.actualMinutes ?? 0));
            const plannedSessionCount = result.blocks.filter((b) => b.workItemId === item.id && b.status === "planned").length;
            const dueSoon = item.dueDate.slice(0, 10) <= addDaysToDateOnly(today, 1);
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
                onToggleComplete={() =>
                  item.status === "completed" ? markWorkItemIncomplete(item.id) : markWorkItemComplete(item.id)
                }
              />
            );
          })
        )}
      </section>

      <AddWorkItemModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={addWorkItem}
        kindOptions={[{ value: "assignment", label: "Assignment" }, { value: "project", label: "Project" }]}
      />
    </div>
  );
}

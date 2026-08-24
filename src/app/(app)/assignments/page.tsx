"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { TaskRow } from "@/components/tasks/TaskRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { AddWorkItemModal } from "@/components/tasks/AddWorkItemModal";
import { useAppData } from "@/lib/data/store";
import { formatDueLabel } from "@/lib/schedule-format";
import { todayDateOnly } from "@/lib/now";

const KIND_LABEL: Record<string, string> = { assignment: "Assignment", project: "Project" };

export default function AssignmentsPage() {
  const { workItems, addWorkItem, markWorkItemComplete, markWorkItemIncomplete } = useAppData();
  const [modalOpen, setModalOpen] = useState(false);
  const today = todayDateOnly();

  const assignments = workItems
    .filter((item) => item.kind === "assignment" || item.kind === "project")
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

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
          assignments.map((item) => (
            <TaskRow
              key={item.id}
              title={item.title}
              subject={item.subject}
              dueLabel={formatDueLabel(item.dueDate, today)}
              status={item.status}
              kindLabel={KIND_LABEL[item.kind] ?? item.kind}
              estimatedMinutes={item.estimatedMinutes}
              onToggleComplete={() =>
                item.status === "completed" ? markWorkItemIncomplete(item.id) : markWorkItemComplete(item.id)
              }
            />
          ))
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

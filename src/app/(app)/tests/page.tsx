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

const KIND_LABEL: Record<string, string> = { test: "Test", quiz: "Quiz" };

export default function TestsPage() {
  const { workItems, addWorkItem, markWorkItemComplete, markWorkItemIncomplete } = useAppData();
  const [modalOpen, setModalOpen] = useState(false);
  const today = todayDateOnly();

  const items = workItems
    .filter((item) => item.kind === "test" || item.kind === "quiz")
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

  return (
    <div>
      <PageHeader
        title="Tests & Quizzes"
        description="Exams and quizzes, tracked separately so prep time gets weighted correctly."
        action={<Button onClick={() => setModalOpen(true)}>Add test or quiz</Button>}
      />

      <section className="rounded-lg border border-border bg-surface p-5">
        {items.length === 0 ? (
          <EmptyState title="No tests or quizzes yet" description="Add one to see it here and in your schedule." />
        ) : (
          items.map((item) => (
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
        kindOptions={[{ value: "test", label: "Test" }, { value: "quiz", label: "Quiz" }]}
      />
    </div>
  );
}

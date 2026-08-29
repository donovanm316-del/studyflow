"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { TaskRow } from "@/components/tasks/TaskRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { WorkItemModal } from "@/components/tasks/WorkItemModal";
import { StageManager } from "@/components/tasks/StageManager";
import { DeadlineInsight } from "@/components/tasks/DeadlineInsight";
import { recommendStartDate, summarizeBuffer } from "@/lib/decision-support";
import { useAppData } from "@/lib/data/store";
import { useSchedule } from "@/lib/data/useSchedule";
import { blockMatchesWorkItem, changesSchedule, formatDueLabel } from "@/lib/schedule-format";
import { todayDateOnly } from "@/lib/now";
import { totalRemainingStageMinutes } from "@/scheduling-engine";
import type { SchedulableWorkItem } from "@/scheduling-engine";

const KIND_LABEL: Record<string, string> = { test: "Test", quiz: "Quiz" };

function addDaysToDateOnly(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}

export default function TestsPage() {
  const {
    workItems,
    planningProfile,
    stages,
    addWorkItem,
    updateWorkItem,
    removeWorkItem,
    markWorkItemComplete,
    markWorkItemIncomplete,
    acceptDecomposition,
    clearStages,
    updateStage,
    removeStage,
    addStage,
  } = useAppData();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<SchedulableWorkItem | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const today = todayDateOnly();

  const items = workItems
    .filter((item) => item.kind === "test" || item.kind === "quiz")
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

  const farthestDue = items.reduce((max, item) => (item.dueDate.slice(0, 10) > max ? item.dueDate.slice(0, 10) : max), today);
  const rangeEnd = farthestDue > addDaysToDateOnly(today, 60) ? addDaysToDateOnly(today, 60) : farthestDue > today ? farthestDue : addDaysToDateOnly(today, 7);
  const result = useSchedule(today, rangeEnd);

  return (
    <div>
      <PageHeader
        title="Tests & Quizzes"
        description="Exams and quizzes, tracked separately so prep time gets weighted correctly."
        action={<Button onClick={() => setAddOpen(true)}>Add test or quiz</Button>}
      />

      {updateNotice && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-md border border-brand-soft bg-brand-soft px-4 py-3 text-sm text-brand-strong">
          <span>{updateNotice}</span>
          <button onClick={() => setUpdateNotice(null)} aria-label="Dismiss" className="text-brand-strong hover:opacity-70">✕</button>
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface p-5">
        {items.length === 0 ? (
          <EmptyState
            title="No tests or quizzes yet"
            description="Add one and StudyFlow will schedule prep time before the date, not on it."
            action={<Button onClick={() => setAddOpen(true)}>Add test or quiz</Button>}
          />
        ) : (
          items.map((item) => {
            const itemStages = stages.filter((s) => s.workItemId === item.id);
            const remainingMinutes =
              itemStages.length > 0 ? totalRemainingStageMinutes(itemStages) : Math.max(0, item.estimatedMinutes - (item.actualMinutes ?? 0));
            const plannedSessionCount = result.blocks.filter(
              (b) => blockMatchesWorkItem(b, item.id, stages) && b.status === "planned"
            ).length;
            const dueSoon = item.dueDate.slice(0, 10) <= addDaysToDateOnly(today, 1);
            const urgent = dueSoon && (item.deadlineStrictness === "hard" || item.deadlineStrictness === "important");
            return (
              <div key={item.id}>
                <TaskRow
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
                  onEdit={() => setEditing(item)}
                />
                <DeadlineInsight
                  buffer={result.deadlineCapacities[item.id] ? summarizeBuffer(result.deadlineCapacities[item.id]) : null}
                  startRecommendation={recommendStartDate(item, result, stages)}
                  estimate={result.estimateAdjustments[item.id]}
                />
                <StageManager
                  item={item}
                  stages={itemStages}
                  onAccept={(newStages) => acceptDecomposition(item.id, newStages)}
                  onClear={() => clearStages(item.id)}
                  onUpdateStage={updateStage}
                  onRemoveStage={removeStage}
                  onAddStage={(title, minutes) => addStage(item.id, title, minutes)}
                />
              </div>
            );
          })
        )}
      </section>

      {addOpen && (
        <WorkItemModal
          open
          onClose={() => setAddOpen(false)}
          onSubmit={addWorkItem}
          kindOptions={[{ value: "test", label: "Test" }, { value: "quiz", label: "Quiz" }]}
          defaultRigor={planningProfile.defaultRigor}
        />
      )}

      {editing && (
        <WorkItemModal
          key={editing.id}
          open
          onClose={() => setEditing(null)}
          onSubmit={(input) => {
            updateWorkItem(editing.id, input);
            if (changesSchedule(editing, input)) {
              setUpdateNotice(`Your schedule was updated to reflect the change to "${input.title}".`);
            }
          }}
          kindOptions={[{ value: "test", label: "Test" }, { value: "quiz", label: "Quiz" }]}
          initial={editing}
          onDelete={() => {
            setConfirmDeleteId(editing.id);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteId != null}
        title="Delete this item?"
        description="This removes it from your tests & quizzes and clears any scheduled prep sessions for it. This can't be undone."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) removeWorkItem(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
      />
    </div>
  );
}

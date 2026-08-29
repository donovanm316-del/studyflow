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
import { addDays, totalRemainingStageMinutes } from "@/scheduling-engine";
import type { SchedulableWorkItem } from "@/scheduling-engine";

const KIND_LABEL: Record<string, string> = { assignment: "Assignment", project: "Project" };

export default function AssignmentsPage() {
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

  const assignments = workItems
    .filter((item) => item.kind === "assignment" || item.kind === "project")
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

  // Wide enough to cover every item's due date (Part 13's "sessions planned before deadline"
  // needs the real schedule up to then), capped so a far-off item can't blow up the range.
  const farthestDue = assignments.reduce((max, item) => (item.dueDate.slice(0, 10) > max ? item.dueDate.slice(0, 10) : max), today);
  const rangeEnd = farthestDue > addDays(today, 60) ? addDays(today, 60) : farthestDue > today ? farthestDue : addDays(today, 7);
  const result = useSchedule(today, rangeEnd);

  return (
    <div>
      <PageHeader
        title="Assignments"
        description="Homework, readings, essays, and projects."
        action={<Button onClick={() => setAddOpen(true)}>Add assignment</Button>}
      />

      {updateNotice && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-md border border-brand-soft bg-brand-soft px-4 py-3 text-sm text-brand-strong">
          <span>{updateNotice}</span>
          <button onClick={() => setUpdateNotice(null)} aria-label="Dismiss" className="text-brand-strong hover:opacity-70">✕</button>
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface p-5">
        {assignments.length === 0 ? (
          <EmptyState
            title="Your assignments will appear here"
            description="Add your first assignment and StudyFlow will figure out where it fits."
            action={<Button onClick={() => setAddOpen(true)}>Add assignment</Button>}
          />
        ) : (
          assignments.map((item) => {
            const itemStages = stages.filter((s) => s.workItemId === item.id);
            const remainingMinutes =
              itemStages.length > 0 ? totalRemainingStageMinutes(itemStages) : Math.max(0, item.estimatedMinutes - (item.actualMinutes ?? 0));
            const plannedSessionCount = result.blocks.filter(
              (b) => blockMatchesWorkItem(b, item.id, stages) && b.status === "planned"
            ).length;
            const dueSoon = item.dueDate.slice(0, 10) <= addDays(today, 1);
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
          kindOptions={[{ value: "assignment", label: "Assignment" }, { value: "project", label: "Project" }]}
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
          kindOptions={[{ value: "assignment", label: "Assignment" }, { value: "project", label: "Project" }]}
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
        description="This removes it from your assignments and clears any scheduled sessions for it. This can't be undone."
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

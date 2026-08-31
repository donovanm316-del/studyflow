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
import { EstimateNeededPrompt } from "@/components/tasks/EstimateNeededPrompt";
import { EstimateQueueModal } from "@/components/tasks/EstimateQueueModal";
import { AssignmentDetailModal } from "@/components/tasks/AssignmentDetailModal";
import { ScheduleChangeNotice } from "@/components/schedule/ScheduleChangeNotice";
import { recommendStartDate, summarizeBuffer } from "@/lib/decision-support";
import { previewSyncImpact } from "@/lib/data/classroom-sync";
import { useAppData } from "@/lib/data/store";
import { useSchedule, useScheduleInput } from "@/lib/data/useSchedule";
import { blockMatchesWorkItem, changesSchedule, formatDueLabel } from "@/lib/schedule-format";
import { todayDateOnly } from "@/lib/now";
import { addDays, totalRemainingStageMinutes } from "@/scheduling-engine";
import type { SchedulableWorkItem, ScheduleChangeSummary } from "@/scheduling-engine";
import type { WorkItemSource } from "@/types/models";

const KIND_LABEL: Record<string, string> = { assignment: "Assignment", project: "Project" };

/** Which provenance the student is currently looking at (Phase 5C, Part 11). */
type SourceFilter = "all" | "manual" | "google-classroom";

const SOURCE_FILTERS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "manual", label: "StudyFlow" },
  { value: "google-classroom", label: "Google Classroom" },
];

function matchesFilter(source: WorkItemSource | undefined, filter: SourceFilter): boolean {
  if (filter === "all") return true;
  if (filter === "manual") return !source || source === "manual";
  return source === filter;
}

export default function AssignmentsPage() {
  const {
    workItems,
    workSessions,
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
  const [viewing, setViewing] = useState<SchedulableWorkItem | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [queueOpen, setQueueOpen] = useState(false);
  // Keyed by item id so the notice survives the EstimateNeededPrompt unmounting once
  // `needsEstimate` clears — the moment the diff needs to become visible is also the moment the
  // condition that rendered the prompt goes false (Part 7).
  const [estimateChanges, setEstimateChanges] = useState<Record<string, ScheduleChangeSummary>>({});
  const [queueSummary, setQueueSummary] = useState<{ count: number; changes: ScheduleChangeSummary } | null>(null);
  const today = todayDateOnly();

  const allAssignments = workItems
    .filter((item) => item.kind === "assignment" || item.kind === "project")
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const courses = [...new Set(allAssignments.map((i) => i.subject).filter((s): s is string => !!s))].sort();
  const assignments = allAssignments
    .filter((item) => matchesFilter(item.source, sourceFilter))
    .filter((item) => courseFilter === "all" || item.subject === courseFilter);
  const needingEstimate = allAssignments.filter((item) => item.needsEstimate);

  // Wide enough to cover every item's due date (Part 13's "sessions planned before deadline"
  // needs the real schedule up to then), capped so a far-off item can't blow up the range.
  // Derived from every assignment, not just the filtered ones, so switching filters never changes
  // what the schedule itself considers — only which rows are shown.
  const farthestDue = allAssignments.reduce((max, item) => (item.dueDate.slice(0, 10) > max ? item.dueDate.slice(0, 10) : max), today);
  const rangeEnd = farthestDue > addDays(today, 60) ? addDays(today, 60) : farthestDue > today ? farthestDue : addDays(today, 7);
  const scheduleInput = useScheduleInput(today, rangeEnd);
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

      {needingEstimate.length >= 2 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-soft bg-warning-soft px-4 py-3 text-sm text-warning">
          <span>{needingEstimate.length} assignments need estimates</span>
          <Button size="sm" onClick={() => setQueueOpen(true)}>
            Review estimates
          </Button>
        </div>
      )}

      {queueSummary && (
        <div className="mb-4">
          <div className="flex items-center justify-between gap-2 rounded-md border border-brand-soft bg-brand-soft px-4 py-3 text-sm text-brand-strong">
            <span>
              {queueSummary.count === 0
                ? "No estimates were entered."
                : `Updated ${queueSummary.count} estimate${queueSummary.count === 1 ? "" : "s"}.`}
            </span>
            <button onClick={() => setQueueSummary(null)} aria-label="Dismiss" className="text-brand-strong hover:opacity-70">✕</button>
          </div>
          <ScheduleChangeNotice summary={queueSummary.changes} />
        </div>
      )}

      {allAssignments.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter by source">
            {SOURCE_FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={sourceFilter === f.value ? "primary" : "secondary"}
                onClick={() => setSourceFilter(f.value)}
                aria-pressed={sourceFilter === f.value}
              >
                {f.label}
              </Button>
            ))}
          </div>
          {courses.length > 1 && (
            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              aria-label="Filter by course"
              className="h-8 rounded-md border border-border-strong bg-surface px-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
            >
              <option value="all">All courses</option>
              {courses.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface p-5">
        {assignments.length === 0 ? (
          allAssignments.length === 0 ? (
            <EmptyState
              title="Your assignments will appear here"
              description="Add your first assignment and StudyFlow will figure out where it fits."
              action={<Button onClick={() => setAddOpen(true)}>Add assignment</Button>}
            />
          ) : (
            <EmptyState
              title="Nothing here"
              description={
                sourceFilter === "google-classroom"
                  ? "No assignments imported from Google Classroom yet."
                  : "No manually-added assignments — everything here came from Google Classroom."
              }
            />
          )
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
                  sourceLabel={item.source === "google-classroom" ? "Google Classroom" : undefined}
                  sourceUrl={item.externalUrl}
                  needsEstimate={item.needsEstimate}
                  isTargetDate={item.source === "google-classroom" && item.deadlineStrictness === "target"}
                  onToggleComplete={() =>
                    item.status === "completed" ? markWorkItemIncomplete(item.id) : markWorkItemComplete(item.id)
                  }
                  onEdit={() => setEditing(item)}
                  onTitleClick={() => setViewing(item)}
                />
                {item.needsEstimate ? (
                  <EstimateNeededPrompt
                    onSave={(estimatedMinutes) => {
                      // Computed against the schedule as it stands right now, before the update
                      // below applies — the same before/after pattern the Classroom sync preview
                      // uses, and the same engine: no second scheduling or explanation system.
                      const diff = previewSyncImpact(scheduleInput, [], [
                        { id: item.id, patch: { estimatedMinutes, needsEstimate: undefined } },
                      ]);
                      updateWorkItem(item.id, { estimatedMinutes, needsEstimate: undefined });
                      setEstimateChanges((c) => ({ ...c, [item.id]: diff }));
                    }}
                  />
                ) : (
                  estimateChanges[item.id] && <ScheduleChangeNotice summary={estimateChanges[item.id]} />
                )}
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

      {viewing && (
        <AssignmentDetailModal
          open
          onClose={() => setViewing(null)}
          item={viewing}
          result={result}
          stages={stages}
          today={today}
          onEdit={() => {
            setEditing(viewing);
            setViewing(null);
          }}
        />
      )}

      {queueOpen && (
        <EstimateQueueModal
          open
          onClose={() => setQueueOpen(false)}
          items={needingEstimate}
          allWorkItems={workItems}
          workSessions={workSessions}
          stages={stages}
          today={today}
          onFinish={(entries) => {
            const patches = Object.entries(entries).map(([id, estimatedMinutes]) => ({
              id,
              patch: { estimatedMinutes, needsEstimate: undefined },
            }));
            const diff = previewSyncImpact(scheduleInput, [], patches);
            for (const [id, estimatedMinutes] of Object.entries(entries)) {
              updateWorkItem(id, { estimatedMinutes, needsEstimate: undefined });
            }
            setQueueSummary({ count: patches.length, changes: diff });
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

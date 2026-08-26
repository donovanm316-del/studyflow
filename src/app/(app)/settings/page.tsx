"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { CommitmentModal } from "@/components/tasks/CommitmentModal";
import { useAppData } from "@/lib/data/store";
import type { BreakPreference, Commitment, FreeTimePriority, WorkStyle, WorkloadTolerance } from "@/types/models";

const selectClassName =
  "h-10 rounded-md border border-border-strong bg-surface px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent";

const CATEGORY_LABEL: Record<Commitment["category"], string> = {
  school: "School",
  sports: "Sports",
  club: "Club",
  work: "Work",
  family: "Family",
  appointment: "Appointment",
  other: "Other",
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function scheduleSummary(commitment: Commitment): string {
  const time = `${commitment.startTime}–${commitment.endTime}`;
  if (commitment.recurrence.type === "weekly") {
    return `${commitment.recurrence.daysOfWeek.map((d) => DAY_LABELS[d]).join(", ")} · ${time}`;
  }
  return `${commitment.recurrence.date} · ${time}`;
}

export default function SettingsPage() {
  const { planningProfile, updatePlanningProfile, commitments, addCommitment, updateCommitment, removeCommitment } = useAppData();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Commitment | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);

  return (
    <div>
      <PageHeader title="Settings" description="Account and planning preferences." />

      {updateNotice && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-md border border-brand-soft bg-brand-soft px-4 py-3 text-sm text-brand-strong">
          <span>{updateNotice}</span>
          <button onClick={() => setUpdateNotice(null)} aria-label="Dismiss" className="text-brand-strong hover:opacity-70">✕</button>
        </div>
      )}

      <div className="flex flex-col gap-6">
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Profile</h2>
          <p className="mb-4 text-xs text-ink-faint">Placeholder — not yet connected to an account.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" placeholder="Alex Rivera" disabled />
            <Input label="Email" type="email" placeholder="you@school.edu" disabled />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-ink">Grade level</label>
              <select disabled className={selectClassName}>
                <option>High school</option>
              </select>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Planning preferences</h2>
          <p className="mb-4 text-xs text-ink-faint">Drives the scheduling engine — changes apply the next time a schedule is generated.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-ink">Workload tolerance</label>
              <select
                className={selectClassName}
                value={planningProfile.workloadTolerance}
                onChange={(e) => updatePlanningProfile({ workloadTolerance: e.target.value as WorkloadTolerance })}
              >
                <option value="light">Light</option>
                <option value="moderate">Moderate</option>
                <option value="heavy">Heavy</option>
                <option value="adaptive">Adaptive</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-ink">Break preference</label>
              <select
                className={selectClassName}
                value={planningProfile.breakPreference}
                onChange={(e) => updatePlanningProfile({ breakPreference: e.target.value as BreakPreference })}
              >
                <option value="frequent">Frequent</option>
                <option value="balanced">Balanced</option>
                <option value="minimal">Minimal</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-ink">Free-time priority</label>
              <select
                className={selectClassName}
                value={planningProfile.freeTimePriority}
                onChange={(e) => updatePlanningProfile({ freeTimePriority: e.target.value as FreeTimePriority })}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-ink">Work style</label>
              <select
                className={selectClassName}
                value={planningProfile.workStyle}
                onChange={(e) => updatePlanningProfile({ workStyle: e.target.value as WorkStyle })}
              >
                <option value="early">Early — finish well before deadlines</option>
                <option value="consistent">Consistent — spread evenly</option>
                <option value="deadline_driven">Deadline-driven</option>
                <option value="adaptive">Adaptive</option>
              </select>
            </div>

            <div className="flex items-center gap-2 sm:col-span-2">
              <input
                id="autoBreaks"
                type="checkbox"
                checked={planningProfile.autoBreaks}
                onChange={(e) => updatePlanningProfile({ autoBreaks: e.target.checked })}
                className="h-4 w-4 rounded border-border-strong accent-brand"
              />
              <label htmlFor="autoBreaks" className="text-sm text-ink">
                Automatically insert breaks between work sessions
              </label>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Commitments</h2>
            <Button size="sm" onClick={() => setAddOpen(true)}>Add commitment</Button>
          </div>
          <p className="mb-4 text-xs text-ink-faint">
            Fixed time the scheduler will never place work over — practice, clubs, work shifts, family time, appointments.
          </p>
          {commitments.length === 0 ? (
            <EmptyState
              title="No commitments yet"
              description="Add one so the scheduler knows when you're already busy."
              action={<Button size="sm" onClick={() => setAddOpen(true)}>Add commitment</Button>}
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {commitments.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{c.title}</span>
                      <Badge tone="neutral">{CATEGORY_LABEL[c.category]}</Badge>
                    </div>
                    <span className="text-xs text-ink-muted">{scheduleSummary(c)}</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label={`Edit ${c.title}`}>
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Connections</h2>
          <p className="mb-4 text-xs text-ink-faint">
            Google Classroom import is planned for a future phase and is not available yet.
          </p>
          <Button variant="secondary" disabled>
            Connect Google Classroom
          </Button>
        </section>
      </div>

      {addOpen && <CommitmentModal open onClose={() => setAddOpen(false)} onSubmit={addCommitment} />}

      {editing && (
        <CommitmentModal
          key={editing.id}
          open
          onClose={() => setEditing(null)}
          onSubmit={(input) => {
            updateCommitment(editing.id, input);
            setUpdateNotice(`Your schedule was updated to reflect the change to "${input.title}".`);
          }}
          initial={editing}
          onDelete={() => {
            setConfirmDeleteId(editing.id);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteId != null}
        title="Delete this commitment?"
        description="StudyFlow will stop protecting this time, and future schedules may place work there. This can't be undone."
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) removeCommitment(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
      />
    </div>
  );
}

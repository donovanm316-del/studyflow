"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { isDecomposable, stageProgress, suggestStages, totalRemainingStageMinutes, formatMinutesAsHoursMinutes } from "@/scheduling-engine";
import type { SchedulableWorkItem } from "@/scheduling-engine";
import type { WorkStage } from "@/types/models";

export interface StageManagerProps {
  item: SchedulableWorkItem;
  /** Already-committed stages for this item, or `[]` if it hasn't been planned in stages. */
  stages: WorkStage[];
  onAccept: (stages: WorkStage[]) => void;
  onClear: () => void;
  onUpdateStage: (id: string, patch: Partial<Pick<WorkStage, "title" | "estimatedMinutes" | "status">>) => void;
  onRemoveStage: (id: string) => void;
  onAddStage: (title: string, estimatedMinutes: number) => void;
}

/**
 * Lightweight stage planning UI (Phase 4, Part 9/10/33) — a proposal-then-accept flow for items
 * that haven't been decomposed yet, and a plain checklist with real edit/remove controls for ones
 * that have. Deliberately not a project-management board: no drag-and-drop, no columns, just an
 * ordered list a student can glance at and understand immediately.
 */
export function StageManager({ item, stages, onAccept, onClear, onUpdateStage, onRemoveStage, onAddStage }: StageManagerProps) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<WorkStage[] | null>(null);

  if (stages.length === 0) {
    if (!isDecomposable(item)) return null;

    if (!expanded) {
      return (
        <div className="mt-2">
          <button
            onClick={() => {
              setDraft(suggestStages(item));
              setExpanded(true);
            }}
            className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            This can be planned in stages — plan in stages
          </button>
        </div>
      );
    }

    const draftStages = draft ?? [];
    return (
      <div className="mt-2 flex flex-col gap-2 rounded-md border border-dashed border-border-strong bg-paper px-3 py-3">
        <p className="text-xs font-medium text-ink">Suggested stages</p>
        <DraftStageList
          stages={draftStages}
          onChange={setDraft}
        />
        <AddStageForm onAdd={(title, minutes) => setDraft([...draftStages, makeDraftStage(item.id, draftStages.length, title, minutes)])} />
        <div className="mt-1 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => { onAccept(draftStages); setExpanded(false); setDraft(null); }}
            disabled={draftStages.length === 0 || draftStages.some((s) => s.estimatedMinutes <= 0)}
          >
            Use these stages
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setExpanded(false); setDraft(null); }}>
            Keep as one task
          </Button>
        </div>
      </div>
    );
  }

  const progress = stageProgress(stages);
  const remaining = totalRemainingStageMinutes(stages);
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  const activeId = ordered.find((s) => s.status !== "completed")?.id;

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-border-strong bg-paper px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-ink">
          {progress.percent}% complete · {progress.completed}/{progress.total} stages · {formatMinutesAsHoursMinutes(remaining)} remaining
        </p>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Keep as one task
        </Button>
      </div>
      <ProgressBar value={progress.percent} />
      <CommittedStageList stages={ordered} activeId={activeId} onUpdateStage={onUpdateStage} onRemoveStage={onRemoveStage} />
      <AddStageForm onAdd={onAddStage} />
    </div>
  );
}

function makeDraftStage(workItemId: string, order: number, title: string, minutes: number): WorkStage {
  return {
    id: `draft_${workItemId}_${order}_${Date.now()}`,
    workItemId,
    title,
    stageType: "custom",
    order,
    estimatedMinutes: minutes,
    status: "not-started",
    dependsOnStageId: undefined,
  };
}

function DraftStageList({ stages, onChange }: { stages: WorkStage[]; onChange: (stages: WorkStage[]) => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {stages.map((stage, i) => (
        <li key={stage.id} className="flex items-center gap-2 text-sm text-ink">
          <span aria-hidden className="w-4 text-ink-faint">
            {i + 1}.
          </span>
          <input
            aria-label={`Stage ${i + 1} name`}
            value={stage.title}
            onChange={(e) => onChange(stages.map((s) => (s.id === stage.id ? { ...s, title: e.target.value } : s)))}
            className="h-8 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <input
            aria-label={`Stage ${i + 1} minutes`}
            type="number"
            min={5}
            step={5}
            value={stage.estimatedMinutes}
            onChange={(e) =>
              onChange(stages.map((s) => (s.id === stage.id ? { ...s, estimatedMinutes: Number(e.target.value) } : s)))
            }
            className="h-8 w-20 rounded-md border border-border-strong bg-surface px-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <span className="text-xs text-ink-faint">min</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Remove stage ${stage.title}`}
            onClick={() => onChange(stages.filter((s) => s.id !== stage.id).map((s, idx) => ({ ...s, order: idx })))}
          >
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}

function CommittedStageList({
  stages,
  activeId,
  onUpdateStage,
  onRemoveStage,
}: {
  stages: WorkStage[];
  activeId: string | undefined;
  onUpdateStage: StageManagerProps["onUpdateStage"];
  onRemoveStage: StageManagerProps["onRemoveStage"];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  // String-backed (Phase 6A, Part 5) — a numeric controlled input snaps back to a literal "0" the
  // instant it's cleared to retype, which is exactly the friction this field must not have.
  const [editMinutesInput, setEditMinutesInput] = useState("");
  const editMinutes = Number(editMinutesInput);
  const editMinutesValid = editMinutesInput.trim() !== "" && Number.isFinite(editMinutes) && editMinutes > 0;

  return (
    <ul className="flex flex-col gap-1">
      {stages.map((stage) => {
        const isDone = stage.status === "completed";
        const isActive = stage.id === activeId;
        const statusLabel = isDone ? "Done" : isActive ? "Next" : "Not started";
        const symbol = isDone ? "✓" : isActive ? "→" : "○";

        if (editingId === stage.id) {
          return (
            <li key={stage.id} className="flex flex-wrap items-center gap-2 text-sm text-ink">
              <Input
                aria-label={`${stage.title} name`}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="h-8 min-w-0 flex-1"
              />
              <Input
                aria-label={`${stage.title} minutes`}
                type="number"
                min={5}
                step={5}
                placeholder="e.g. 20"
                value={editMinutesInput}
                onChange={(e) => setEditMinutesInput(e.target.value)}
                className="h-8 w-20"
              />
              <Button
                size="sm"
                disabled={!editMinutesValid}
                onClick={() => {
                  onUpdateStage(stage.id, { title: editTitle.trim() || stage.title, estimatedMinutes: editMinutes });
                  setEditingId(null);
                }}
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </li>
          );
        }

        return (
          <li key={stage.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDone}
              onChange={(e) => onUpdateStage(stage.id, { status: e.target.checked ? "completed" : "not-started" })}
              aria-label={`Mark "${stage.title}" ${isDone ? "not done" : "done"}`}
              className="h-4 w-4 shrink-0 rounded border-border-strong accent-brand"
            />
            <span aria-hidden className="w-4 text-ink-faint">
              {symbol}
            </span>
            <span className={isDone ? "flex-1 truncate text-ink-muted line-through" : "flex-1 truncate text-ink"}>{stage.title}</span>
            <span className="shrink-0 text-xs text-ink-faint">
              {statusLabel} · {stage.estimatedMinutes} min
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Edit ${stage.title}`}
              onClick={() => {
                setEditingId(stage.id);
                setEditTitle(stage.title);
                setEditMinutesInput(String(stage.estimatedMinutes));
              }}
            >
              Edit
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Remove ${stage.title}`} onClick={() => onRemoveStage(stage.id)}>
              Remove
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function AddStageForm({ onAdd }: { onAdd: (title: string, minutes: number) => void }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  // String-backed, starts empty (Phase 6A, Part 5) — same fix as every other estimate field, so a
  // student can type a real number immediately instead of clearing a pre-filled one first.
  const [minutesInput, setMinutesInput] = useState("");
  const minutes = Number(minutesInput);
  const minutesValid = minutesInput.trim() !== "" && Number.isFinite(minutes) && minutes > 0;

  if (!adding) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(true)} className="self-start">
        Add stage
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label="New stage name" placeholder="Stage name" value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 min-w-0 flex-1" />
      <Input
        aria-label="New stage minutes"
        type="number"
        min={5}
        step={5}
        placeholder="e.g. 20"
        value={minutesInput}
        onChange={(e) => setMinutesInput(e.target.value)}
        className="h-8 w-20"
      />
      <Button
        size="sm"
        disabled={!title.trim() || !minutesValid}
        onClick={() => {
          const trimmed = title.trim();
          if (!trimmed || !minutesValid) return;
          onAdd(trimmed, minutes);
          setTitle("");
          setMinutesInput("");
          setAdding(false);
        }}
      >
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
        Cancel
      </Button>
    </div>
  );
}

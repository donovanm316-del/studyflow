"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { DEFAULT_DEADLINE_TIME, formatClockTime, normalizeDeadline, weekdayName } from "@/scheduling-engine";

/** "September 9" — the month/day half of the deadline echo. */
function formatLongDate(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}
import type { NewWorkItemInput } from "@/lib/data/store";
import type { SchedulableWorkItem } from "@/scheduling-engine";
import type { AssignmentWeight, CourseRigor, DeadlineStrictness, WorkType } from "@/types/models";

const selectClassName =
  "h-10 rounded-md border border-border-strong bg-surface px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent";

export interface WorkItemModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: NewWorkItemInput) => void;
  /** Which kind(s) this modal can create. A single-option list hides the kind selector. Ignored when editing (the kind can't change). */
  kindOptions: { value: "assignment" | "test" | "quiz" | "project"; label: string }[];
  /** Present → the modal opens pre-filled in edit mode; absent → a fresh "add" form. */
  initial?: SchedulableWorkItem;
  /** Preselected rigor for a brand-new item (e.g. the student's Planning Profile default). Ignored when editing. */
  defaultRigor?: CourseRigor;
  /** Shown only in edit mode. The caller owns confirming the delete before actually removing it. */
  onDelete?: () => void;
}

const WORK_TYPE_OPTIONS_BY_KIND: Record<string, { value: WorkType; label: string }[]> = {
  assignment: [
    { value: "homework", label: "Homework" },
    { value: "reading", label: "Reading" },
    { value: "essay", label: "Essay" },
    { value: "long-term", label: "Long-term assignment" },
  ],
  test: [{ value: "test-prep", label: "Test prep" }],
  quiz: [{ value: "quiz-prep", label: "Quiz prep" }],
  project: [{ value: "project", label: "Project" }],
};

function toDateInputValue(dueDateIso: string): string {
  return normalizeDeadline(dueDateIso).slice(0, 10);
}

function toTimeInputValue(dueDateIso: string): string {
  return normalizeDeadline(dueDateIso).slice(11, 16);
}

export function WorkItemModal({ open, onClose, onSubmit, kindOptions, initial, defaultRigor, onDelete }: WorkItemModalProps) {
  const isEditing = !!initial;
  const [kind, setKind] = useState(initial?.kind ?? kindOptions[0].value);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [dueDate, setDueDate] = useState(initial ? toDateInputValue(initial.dueDate) : "");
  // 11:59 PM by default — what "due Friday" means for ordinary homework. Fully editable for the
  // cases where the exact time matters (a test at 9:00 AM, an essay due at 3:00 PM).
  const [dueTime, setDueTime] = useState(initial ? toTimeInputValue(initial.dueDate) : DEFAULT_DEADLINE_TIME);
  // Undefined on an existing item means "yes" — the Phase 4.5C behavior — so it maps to true here.
  const [usePersonalized, setUsePersonalized] = useState(initial?.usePersonalizedEstimate !== false);
  const [preferredStartDate, setPreferredStartDate] = useState(initial?.preferredStartDate ?? "");
  const [estimatedMinutes, setEstimatedMinutes] = useState(initial?.estimatedMinutes ?? 30);
  const [weight, setWeight] = useState<AssignmentWeight>(initial?.weight ?? "medium");
  const [deadlineStrictness, setDeadlineStrictness] = useState<DeadlineStrictness>(initial?.deadlineStrictness ?? "hard");
  const [rigor, setRigor] = useState<CourseRigor>(initial?.rigor ?? defaultRigor ?? "grade_level");
  const [titleError, setTitleError] = useState<string | undefined>();
  const [dueDateError, setDueDateError] = useState<string | undefined>();

  const workTypeOptions = WORK_TYPE_OPTIONS_BY_KIND[kind];
  const [workType, setWorkType] = useState<WorkType>(initial?.workType ?? workTypeOptions[0].value);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    let hasError = false;
    if (!trimmedTitle) {
      setTitleError("Enter a title so you can find this later.");
      hasError = true;
    } else {
      setTitleError(undefined);
    }
    if (!dueDate) {
      setDueDateError("A due date is required so StudyFlow knows when to schedule this.");
      hasError = true;
    } else {
      setDueDateError(undefined);
    }
    if (hasError) return;

    onSubmit({
      kind,
      title: trimmedTitle,
      subject: subject.trim() || undefined,
      dueDate: `${dueDate}T${dueTime || DEFAULT_DEADLINE_TIME}`,
      preferredStartDate: preferredStartDate || undefined,
      estimatedMinutes,
      weight,
      deadlineStrictness,
      workType,
      rigor,
      usePersonalizedEstimate: usePersonalized,
      // Provenance is preserved across edits — editing an imported item must not silently turn it
      // into a manually-created one (Phase 4.5D, Part 13), and the sync baseline must survive too
      // or the next sync would re-report the student's own edit as a teacher change (Phase 5B).
      source: initial?.source,
      externalId: initial?.externalId,
      externalCourseId: initial?.externalCourseId,
      externalUrl: initial?.externalUrl,
      sourceUpdatedAt: initial?.sourceUpdatedAt,
      sourceSnapshot: initial?.sourceSnapshot,
      // Saving this form *is* the student supplying an estimate, so the placeholder flag clears
      // whether or not they touched the field — from here on the number is theirs.
      needsEstimate: undefined,
    } as NewWorkItemInput);

    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={isEditing ? "Edit item" : "Add work item"}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        {kindOptions.length > 1 && !isEditing && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-ink">Type</label>
            <select
              className={selectClassName}
              value={kind}
              onChange={(e) => {
                const next = e.target.value as typeof kind;
                setKind(next);
                setWorkType(WORK_TYPE_OPTIONS_BY_KIND[next][0].value);
              }}
            >
              {kindOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g. Unit 4 Test"
          error={titleError}
        />
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Algebra II" />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Due date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
            error={dueDateError}
          />
          <Input
            label="Due time"
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            hint="Defaults to 11:59 PM"
          />
        </div>

        {/* The exact deadline drives most of the engine's behavior, so it's echoed back in plain
            language rather than left implicit in two separate inputs (Phase 4.5D, Part 2). */}
        {dueDate && (
          <p className="-mt-2 text-xs text-ink-muted">
            Due {weekdayName(dueDate)}, {formatLongDate(dueDate)} at {formatClockTime(dueTime || DEFAULT_DEADLINE_TIME)}
          </p>
        )}

        <Input
          label="Estimated minutes"
          type="number"
          min={5}
          step={5}
          value={estimatedMinutes}
          onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
          hint="Your own estimate. StudyFlow keeps this even if it plans differently."
        />

        <div className="flex items-start gap-2">
          <input
            id={`personalized-${initial?.id ?? "new"}`}
            type="checkbox"
            checked={usePersonalized}
            onChange={(e) => setUsePersonalized(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong accent-brand"
          />
          <label htmlFor={`personalized-${initial?.id ?? "new"}`} className="text-sm text-ink">
            Let StudyFlow adjust this from my history
            <span className="block text-xs text-ink-muted">
              When you&apos;ve completed enough similar work, planning can use how long it actually took. Turn this
              off to plan with your estimate exactly as entered.
            </span>
          </label>
        </div>

        <Input
          label="Start no earlier than (optional)"
          type="date"
          value={preferredStartDate}
          max={dueDate || undefined}
          onChange={(e) => setPreferredStartDate(e.target.value)}
        />

        {workTypeOptions.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-ink">Work type</label>
            <select className={selectClassName} value={workType} onChange={(e) => setWorkType(e.target.value as WorkType)}>
              {workTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-ink">Importance</label>
            <select className={selectClassName} value={weight} onChange={(e) => setWeight(e.target.value as AssignmentWeight)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-ink">Deadline</label>
            <select
              className={selectClassName}
              value={deadlineStrictness}
              onChange={(e) => setDeadlineStrictness(e.target.value as DeadlineStrictness)}
            >
              <option value="hard">Hard</option>
              <option value="important">Important</option>
              <option value="flexible">Flexible</option>
              <option value="target">Target (self-set)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink">Course rigor</label>
          <select className={selectClassName} value={rigor} onChange={(e) => setRigor(e.target.value as CourseRigor)}>
            <option value="grade_level">Grade level</option>
            <option value="honors">Honors</option>
            <option value="ap">AP</option>
            <option value="ib">IB</option>
            <option value="college_level">College level</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          {isEditing && onDelete ? (
            <Button type="button" variant="ghost" className="text-danger hover:bg-danger-soft" onClick={onDelete}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{isEditing ? "Save changes" : "Add"}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

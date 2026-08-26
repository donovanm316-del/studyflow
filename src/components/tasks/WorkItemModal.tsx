"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
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
  return dueDateIso.slice(0, 10);
}

export function WorkItemModal({ open, onClose, onSubmit, kindOptions, initial, defaultRigor, onDelete }: WorkItemModalProps) {
  const isEditing = !!initial;
  const [kind, setKind] = useState(initial?.kind ?? kindOptions[0].value);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [dueDate, setDueDate] = useState(initial ? toDateInputValue(initial.dueDate) : "");
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
      dueDate: `${dueDate}T23:59`,
      preferredStartDate: preferredStartDate || undefined,
      estimatedMinutes,
      weight,
      deadlineStrictness,
      workType,
      rigor,
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
            label="Estimated minutes"
            type="number"
            min={5}
            step={5}
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
          />
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

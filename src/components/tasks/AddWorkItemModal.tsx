"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { NewWorkItemInput } from "@/lib/data/store";
import type { AssignmentWeight, CourseRigor, DeadlineStrictness, WorkType } from "@/types/models";

const selectClassName =
  "h-10 rounded-md border border-border-strong bg-surface px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent";

export interface AddWorkItemModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: NewWorkItemInput) => void;
  /** Which kind(s) this modal can create. A single-option list hides the kind selector. */
  kindOptions: { value: "assignment" | "test" | "quiz" | "project"; label: string }[];
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

export function AddWorkItemModal({ open, onClose, onSubmit, kindOptions }: AddWorkItemModalProps) {
  const [kind, setKind] = useState(kindOptions[0].value);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState(30);
  const [weight, setWeight] = useState<AssignmentWeight>("medium");
  const [deadlineStrictness, setDeadlineStrictness] = useState<DeadlineStrictness>("hard");
  const [rigor, setRigor] = useState<CourseRigor>("grade_level");

  const workTypeOptions = WORK_TYPE_OPTIONS_BY_KIND[kind];
  const [workType, setWorkType] = useState<WorkType>(workTypeOptions[0].value);

  function reset() {
    setKind(kindOptions[0].value);
    setTitle("");
    setSubject("");
    setDueDate("");
    setEstimatedMinutes(30);
    setWeight("medium");
    setDeadlineStrictness("hard");
    setRigor("grade_level");
    setWorkType(WORK_TYPE_OPTIONS_BY_KIND[kindOptions[0].value][0].value);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !dueDate) return;

    onSubmit({
      kind,
      title: title.trim(),
      subject: subject.trim() || undefined,
      dueDate: `${dueDate}T23:59`,
      estimatedMinutes,
      weight,
      deadlineStrictness,
      workType,
      rigor,
    } as NewWorkItemInput);

    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add work item">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        {kindOptions.length > 1 && (
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

        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Unit 4 Test" />
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Algebra II" />

        <div className="grid grid-cols-2 gap-4">
          <Input label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
          <Input
            label="Estimated minutes"
            type="number"
            min={5}
            step={5}
            value={estimatedMinutes}
            onChange={(e) => setEstimatedMinutes(Number(e.target.value))}
          />
        </div>

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
            <label className="text-sm font-medium text-ink">Weight</label>
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

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Add</Button>
        </div>
      </form>
    </Modal>
  );
}

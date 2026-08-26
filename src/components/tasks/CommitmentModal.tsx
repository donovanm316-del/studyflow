"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { Commitment } from "@/types/models";

const selectClassName =
  "h-10 rounded-md border border-border-strong bg-surface px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CATEGORY_OPTIONS: { value: Commitment["category"]; label: string }[] = [
  { value: "school", label: "School" },
  { value: "sports", label: "Sports" },
  { value: "club", label: "Club" },
  { value: "work", label: "Work" },
  { value: "family", label: "Family" },
  { value: "appointment", label: "Appointment" },
  { value: "other", label: "Other" },
];

export interface CommitmentModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: Omit<Commitment, "id" | "userId">) => void;
  /** Present → the modal opens pre-filled in edit mode instead of add mode. */
  initial?: Commitment;
  /** Shown only in edit mode. The caller owns confirming the delete before actually removing it. */
  onDelete?: () => void;
}

export function CommitmentModal({ open, onClose, onSubmit, initial, onDelete }: CommitmentModalProps) {
  const isEditing = !!initial;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState<Commitment["category"]>(initial?.category ?? "school");
  const [isRecurring, setIsRecurring] = useState(initial ? initial.recurrence.type === "weekly" : true);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    initial?.recurrence.type === "weekly" ? initial.recurrence.daysOfWeek : [1, 2, 3, 4, 5]
  );
  const [date, setDate] = useState(initial?.recurrence.type === "one-off" ? initial.recurrence.date : "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "16:00");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "17:00");
  const [titleError, setTitleError] = useState<string | undefined>();
  const [timeError, setTimeError] = useState<string | undefined>();
  const [dateError, setDateError] = useState<string | undefined>();
  const [daysError, setDaysError] = useState<string | undefined>();

  function toggleDay(day: number) {
    setDaysOfWeek((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const nextTitleError = trimmedTitle ? undefined : "Give this commitment a name.";
    const nextTimeError = startTime < endTime ? undefined : "End time must be after the start time.";
    const nextDateError = !isRecurring && !date ? "Pick a date for a one-time commitment." : undefined;
    const nextDaysError = isRecurring && daysOfWeek.length === 0 ? "Pick at least one day." : undefined;

    setTitleError(nextTitleError);
    setTimeError(nextTimeError);
    setDateError(nextDateError);
    setDaysError(nextDaysError);
    if (nextTitleError || nextTimeError || nextDateError || nextDaysError) return;

    onSubmit({
      title: trimmedTitle,
      category,
      recurrence: isRecurring ? { type: "weekly", daysOfWeek } : { type: "one-off", date },
      startTime,
      endTime,
    });

    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={isEditing ? "Edit commitment" : "Add commitment"}>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g. Soccer practice"
          error={titleError}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-ink">Category</label>
          <select className={selectClassName} value={category} onChange={(e) => setCategory(e.target.value as Commitment["category"])}>
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={isRecurring} onChange={() => setIsRecurring(true)} className="accent-brand" />
            Recurring
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={!isRecurring} onChange={() => setIsRecurring(false)} className="accent-brand" />
            One-time
          </label>
        </div>

        {isRecurring ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-ink">Days of week</label>
            <div className="flex gap-1.5">
              {DAY_LABELS.map((label, day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  aria-pressed={daysOfWeek.includes(day)}
                  aria-label={label}
                  className={`h-8 w-8 rounded-full border text-xs font-medium transition-colors ${
                    daysOfWeek.includes(day)
                      ? "border-transparent bg-brand text-white"
                      : "border-border-strong bg-surface text-ink-muted hover:bg-paper"
                  }`}
                >
                  {label[0]}
                </button>
              ))}
            </div>
            {daysError && <span className="text-xs text-danger">{daysError}</span>}
          </div>
        ) : (
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required error={dateError} />
        )}

        <div className="grid grid-cols-2 gap-4">
          <Input label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          <Input label="End time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required error={timeError} />
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
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit">{isEditing ? "Save changes" : "Add"}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

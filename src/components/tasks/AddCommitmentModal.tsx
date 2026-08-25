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

export interface AddCommitmentModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: Omit<Commitment, "id" | "userId">) => void;
}

export function AddCommitmentModal({ open, onClose, onSubmit }: AddCommitmentModalProps) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Commitment["category"]>("school");
  const [isRecurring, setIsRecurring] = useState(true);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("16:00");
  const [endTime, setEndTime] = useState("17:00");

  function reset() {
    setTitle("");
    setCategory("school");
    setIsRecurring(true);
    setDaysOfWeek([1, 2, 3, 4, 5]);
    setDate("");
    setStartTime("16:00");
    setEndTime("17:00");
  }

  function toggleDay(day: number) {
    setDaysOfWeek((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || startTime >= endTime) return;
    if (isRecurring && daysOfWeek.length === 0) return;
    if (!isRecurring && !date) return;

    onSubmit({
      title: title.trim(),
      category,
      recurrence: isRecurring ? { type: "weekly", daysOfWeek } : { type: "one-off", date },
      startTime,
      endTime,
    });

    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add commitment">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Soccer practice" />

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
          </div>
        ) : (
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        )}

        <div className="grid grid-cols-2 gap-4">
          <Input label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          <Input label="End time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit">Add</Button>
        </div>
      </form>
    </Modal>
  );
}

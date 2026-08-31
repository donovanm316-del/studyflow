"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatDueLabel } from "@/lib/schedule-format";
import { buildEstimateHistory, formatMinutesAsHoursMinutes, suggestDurationFromHistory, type SchedulableWorkItem } from "@/scheduling-engine";
import type { WorkSession, WorkStage } from "@/types/models";

/**
 * Working through several "estimate needed" items in one sitting (Phase 5C, Part 4).
 *
 * Purely a review flow — every save is collected locally as the student steps through, and applied
 * to the store as one batch when they finish, skip to the end, or close early. That mirrors how the
 * Classroom sync review already works (review, then one `apply`), and it means the resulting
 * schedule-impact notice reflects the whole session at once rather than N separate diffs.
 *
 * The optional "past similar work" line comes from `suggestDurationFromHistory` — the same
 * category-matching/recency rules `personalizeEstimate` already uses, just reading real recorded
 * durations instead of a ratio. It is a suggestion only: the input starts empty, and nothing here
 * fills it in automatically.
 */
export interface EstimateQueueModalProps {
  open: boolean;
  onClose: () => void;
  /** Items needing an estimate, in the order they'll be reviewed. */
  items: SchedulableWorkItem[];
  /** Full item list and session history, for the personalization suggestion — same inputs `buildEstimateHistory` always takes. */
  allWorkItems: SchedulableWorkItem[];
  workSessions: WorkSession[];
  stages: WorkStage[];
  today: string;
  /** Applies everything the student entered as one batch, and reports what schedule impact it had. */
  onFinish: (entries: Record<string, number>) => void;
}

export function EstimateQueueModal({ open, onClose, items, allWorkItems, workSessions, stages, today, onFinish }: EstimateQueueModalProps) {
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [entries, setEntries] = useState<Record<string, number>>({});

  const history = useMemo(() => buildEstimateHistory(workSessions, allWorkItems, stages), [workSessions, allWorkItems, stages]);

  const current = items[index];
  const suggestion = current ? suggestDurationFromHistory(current.workType, history, current.rigor, current.subject) : null;
  const remaining = items.length - index;

  function advance(nextEntries: Record<string, number>) {
    setEntries(nextEntries);
    setValue("");
    if (index + 1 >= items.length) {
      onFinish(nextEntries);
      onClose();
    } else {
      setIndex(index + 1);
    }
  }

  function saveAndNext() {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    advance({ ...entries, [current.id]: minutes });
  }

  function skip() {
    advance(entries);
  }

  function finishLater() {
    onFinish(entries);
    onClose();
  }

  if (!current) return null;

  return (
    <Modal open={open} onClose={finishLater} title="Assignments needing estimates">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-ink-faint">
          {remaining} of {items.length} left · your estimate is what StudyFlow plans with — Classroom never supplies one.
        </p>

        <div>
          <p className="text-sm font-medium text-ink">{current.title}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {current.subject && <>{current.subject} · </>}
            {formatDueLabel(current.dueDate, today)}
          </p>
        </div>

        {suggestion && (
          <p className="text-xs text-ink-muted">
            Your past similar work usually takes about {formatMinutesAsHoursMinutes(suggestion.lowMinutes)}–
            {formatMinutesAsHoursMinutes(suggestion.highMinutes)}, based on {suggestion.sampleSize} recorded session
            {suggestion.sampleSize === 1 ? "" : "s"}. This is a suggestion — your own number is what StudyFlow uses.
          </p>
        )}

        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          How long do you think this will take?
          <input
            type="number"
            min={5}
            step={5}
            placeholder={suggestion ? String(suggestion.medianMinutes) : "Minutes"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Estimated minutes"
            autoFocus
            className="h-10 w-32 rounded-md border border-border-strong bg-surface px-2 text-sm text-ink"
          />
        </label>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={finishLater}>
            Finish later
          </Button>
          <Button variant="secondary" onClick={skip}>
            Skip
          </Button>
          <Button onClick={saveAndNext} disabled={!value}>
            {index + 1 >= items.length ? "Save" : "Save & next"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

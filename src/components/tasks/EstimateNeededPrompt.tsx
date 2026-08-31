"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * The quick-entry flow for an item StudyFlow is planning against a placeholder duration (Phase 5C,
 * Part 7).
 *
 * Deliberately not a Classroom-specific estimator: entering a number here does exactly what typing
 * one into the normal edit form does — clears `needsEstimate`, and nothing else about the item
 * changes. No second estimation system, no guessed number — the field starts empty and stays that
 * way until the student types something.
 *
 * Purely presentational: it hands the number to `onSave` and gets out of the way. The schedule-diff
 * that follows is computed and rendered by the caller, not here — this component's own local state
 * would be unmounted the instant `needsEstimate` clears (which is exactly when the diff needs to
 * become visible), so keeping the result here would show it for zero frames before losing it.
 */
export function EstimateNeededPrompt({ onSave }: { onSave: (estimatedMinutes: number) => void }) {
  const [value, setValue] = useState("");

  function save() {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    onSave(minutes);
  }

  return (
    <div className="mt-2 rounded-md border border-warning-soft bg-warning-soft px-3 py-2">
      <p className="text-xs font-medium text-warning">Estimate needed</p>
      <p className="mb-2 text-xs text-ink-muted">How long do you think this will take?</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={5}
          step={5}
          placeholder="Minutes"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Estimated minutes"
          className="h-9 w-24 rounded-md border border-border-strong bg-surface px-2 text-sm text-ink"
        />
        <Button size="sm" onClick={save} disabled={!value}>
          Save
        </Button>
      </div>
    </div>
  );
}

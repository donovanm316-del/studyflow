"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatMinutesAsHoursMinutes } from "@/scheduling-engine";
import { formatTimeRange } from "@/lib/schedule-format";
import type { TimeSuggestion } from "@/lib/decision-support";

const PRESETS = [15, 30, 60];

export interface TimeAvailableCardProps {
  /** Runs the real lookup for a given window; returns null when nothing genuinely fits. */
  onFind: (minutes: number) => TimeSuggestion | null;
  onStart: (suggestion: TimeSuggestion) => void;
  startDisabled?: boolean;
  /** True when the student has no outstanding work at all — changes the empty wording (Part 7). */
  caughtUp: boolean;
}

/**
 * "I have 30 minutes" (Phase 4.5B, Part 7) — the student states the time they actually have, and
 * StudyFlow names the best real use of it. Suggestions come from sessions the engine already
 * placed, so every constraint (deadlines, commitments, capacity, profile) is inherently respected.
 */
export function TimeAvailableCard({ onFind, onStart, startDisabled, caughtUp }: TimeAvailableCardProps) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState<TimeSuggestion | null>(null);

  function choose(minutes: number) {
    setChosen(minutes);
    setSuggestion(onFind(minutes));
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">How much time do you have?</h2>
      <p className="mt-1 text-xs text-ink-muted">
        StudyFlow will pick the most useful thing you can genuinely finish (or start) in that window.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {PRESETS.map((minutes) => (
          <Button
            key={minutes}
            size="sm"
            variant={chosen === minutes ? "primary" : "secondary"}
            aria-pressed={chosen === minutes}
            onClick={() => choose(minutes)}
          >
            {minutes} min
          </Button>
        ))}
        {chosen !== null && (
          <Button size="sm" variant="ghost" onClick={() => { setChosen(null); setSuggestion(null); }}>
            Clear
          </Button>
        )}
      </div>

      {chosen !== null && (
        <div className="mt-3 rounded-md border border-dashed border-border-strong bg-paper px-3 py-3">
          {suggestion ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Best use of your {chosen} minutes
              </p>
              <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{suggestion.block.title}</p>
                  <p className="text-xs text-ink-muted">
                    {formatMinutesAsHoursMinutes(suggestion.minutes)}
                    {suggestion.partial && " (a start on it)"} · {formatTimeRange(suggestion.block)}
                  </p>
                </div>
                <Button size="sm" disabled={startDisabled} onClick={() => onStart(suggestion)}>
                  Start
                </Button>
              </div>
              <p className="mt-2 text-xs text-ink-muted">{suggestion.reason}</p>
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              {caughtUp
                ? "You're caught up. Enjoy the break."
                : "Nothing needs to be squeezed into this time."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

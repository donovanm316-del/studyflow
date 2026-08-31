"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatMinutesAsHoursMinutes } from "@/scheduling-engine";
import type { NextBestAction } from "@/lib/next-best-action";

export interface NextUpCardProps {
  action: NextBestAction;
  onStart?: () => void;
  startDisabled?: boolean;
  /** Dashboard's lightweight variant (Phase 4, Part 23) — no reason disclosure, smaller footprint. */
  compact?: boolean;
  /**
   * Where the recommended work came from, when it happens to be Classroom (Phase 5C, Part 8) —
   * purely presentational. The recommendation itself is unchanged: `getNextBestAction` picks the
   * next block the same way regardless of source, and this label never influences that choice.
   */
  sourceLabel?: string;
}

/**
 * "Your next move" — the single decision-support panel shared by Dashboard and Today (Phase 4,
 * Part 22; upgraded in Phase 4.5B, Part 1/2). Presentation-only: the caller decides what "Start"
 * does and whether it's currently allowed.
 */
export function NextUpCard({ action, onStart, startDisabled, compact, sourceLabel }: NextUpCardProps) {
  const [showWhy, setShowWhy] = useState(false);

  if (action.kind === "current-session") return null;

  if (action.kind === "no-work") {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm font-medium text-ink">{action.message}</p>
        {action.freeMinutes > 0 && (
          <p className="mt-1 text-sm text-ink-muted">
            You have about {formatMinutesAsHoursMinutes(action.freeMinutes)} of free time left today.
          </p>
        )}
        {action.optional.length > 0 && <p className="mt-1 text-xs text-ink-faint">{action.optional[0].reason}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Your next move</p>

      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
            {action.block.title}
            {sourceLabel && <Badge tone="brand" className="shrink-0">{sourceLabel}</Badge>}
          </p>
          <p className="text-xs text-ink-muted">
            {action.minutesLabel}
            {action.dueLabel && <> · {action.dueLabel}</>}
          </p>
        </div>
        {onStart && (
          <Button size="sm" disabled={startDisabled} onClick={onStart}>
            Start session
          </Button>
        )}
      </div>

      {action.buffer && action.buffer.capacity.estimatedMinutes > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          <span aria-hidden>{action.buffer.icon}</span>{" "}
          <span className="font-medium text-ink">{action.buffer.label}</span> — {action.buffer.sentence}
        </p>
      )}

      {!compact && action.after && (
        <p className="mt-2 text-xs text-ink-faint">
          After this: {action.after.title} — {action.after.minutesLabel}
        </p>
      )}

      {!compact && action.whyNow.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowWhy(!showWhy)}
            aria-expanded={showWhy}
            className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {showWhy ? "Hide reason" : "Why now?"}
          </button>
          {showWhy && (
            <ul className="mt-1 flex flex-col gap-0.5 rounded-md border border-dashed border-border-strong bg-paper px-3 py-2">
              {action.whyNow.map((reason, i) => (
                <li key={i} className="text-xs text-ink-muted">
                  • {reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

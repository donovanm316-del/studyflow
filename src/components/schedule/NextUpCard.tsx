"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { NextBestAction } from "@/lib/next-best-action";

export interface NextUpCardProps {
  action: NextBestAction;
  onStart?: () => void;
  startDisabled?: boolean;
  /** Dashboard's lightweight variant (Phase 4, Part 23) — no reason disclosure, smaller footprint. */
  compact?: boolean;
}

/**
 * The single "what should I do next" panel shared by Dashboard and Today (Phase 4, Part 15/16/22).
 * Presentation-only: the caller decides what "Start" does and whether it's currently allowed
 * (e.g. disabled while another session is already active).
 */
export function NextUpCard({ action, onStart, startDisabled, compact }: NextUpCardProps) {
  const [showWhy, setShowWhy] = useState(false);

  if (action.kind === "current-session") return null;

  if (action.kind === "no-work") {
    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-ink-muted">{action.message}</p>
        {action.optional.length > 0 && (
          <p className="mt-1 text-xs text-ink-faint">{action.optional[0].reason}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Next up</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink">{action.block.title}</p>
          <p className="text-xs text-ink-muted">{action.minutesLabel}</p>
        </div>
        {onStart && (
          <Button size="sm" disabled={startDisabled} onClick={onStart}>
            Start
          </Button>
        )}
      </div>
      {!compact && action.after && (
        <p className="mt-2 text-xs text-ink-faint">
          After this: {action.after.title} — {action.after.minutesLabel}
        </p>
      )}
      {!compact && action.reasonBullets.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setShowWhy(!showWhy)}
            aria-expanded={showWhy}
            className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {showWhy ? "Hide reason" : "What should I work on?"}
          </button>
          {showWhy && (
            <ul className="mt-1 flex flex-col gap-0.5 rounded-md border border-dashed border-border-strong bg-paper px-3 py-2">
              {action.reasonBullets.map((bullet, i) => (
                <li key={i} className="text-xs text-ink-muted">
                  • {bullet}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

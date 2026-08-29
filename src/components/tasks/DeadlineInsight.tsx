"use client";

import { formatMinutesAsHoursMinutes } from "@/scheduling-engine";
import type { BufferSummary, StartRecommendation } from "@/lib/decision-support";

const TONE: Record<BufferSummary["label"], string> = {
  Comfortable: "text-success",
  Tight: "text-warning",
  "At risk": "text-danger",
  Overdue: "text-danger",
};

/**
 * The buffer/shortfall picture for one work item, plus a start recommendation for large work
 * (Phase 4.5B, Part 3/4/8). Every number is the engine's own — this component never computes a
 * second opinion, and renders nothing at all when there's no real work left to reason about.
 */
export function DeadlineInsight({
  buffer,
  startRecommendation,
}: {
  buffer: BufferSummary | null;
  startRecommendation: StartRecommendation | null;
}) {
  if (!buffer && !startRecommendation) return null;
  if (buffer && buffer.capacity.estimatedMinutes <= 0 && !startRecommendation) return null;

  return (
    <div className="mt-2 rounded-md border border-border-strong bg-paper px-3 py-2">
      {buffer && buffer.capacity.estimatedMinutes > 0 && (
        <>
          <p className="text-xs">
            <span aria-hidden>{buffer.icon}</span>{" "}
            <span className={`font-medium ${TONE[buffer.label]}`}>{buffer.label}</span>
            <span className="text-ink-muted"> — {buffer.sentence}</span>
          </p>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-faint">
            <span>Work left: {formatMinutesAsHoursMinutes(buffer.capacity.estimatedMinutes)}</span>
            <span>Usable time before deadline: {formatMinutesAsHoursMinutes(buffer.capacity.availableMinutes)}</span>
            <span>
              {buffer.capacity.bufferMinutes < 0 ? "Shortfall: " : "Buffer: "}
              {formatMinutesAsHoursMinutes(Math.abs(buffer.capacity.bufferMinutes))}
            </span>
          </p>
        </>
      )}

      {startRecommendation && (
        <p className={buffer && buffer.capacity.estimatedMinutes > 0 ? "mt-2 text-xs text-ink-muted" : "text-xs text-ink-muted"}>
          <span className="font-medium text-ink">Planned across {startRecommendation.sessionCount} sessions.</span>{" "}
          {startRecommendation.reason}
        </p>
      )}
    </div>
  );
}

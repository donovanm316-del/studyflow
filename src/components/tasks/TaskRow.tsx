import { Badge, BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { WorkItemStatus } from "@/types/models";

export interface TaskRowProps {
  title: string;
  subject?: string;
  dueLabel: string;
  status: WorkItemStatus;
  kindLabel: string;
  estimatedMinutes: number;
  className?: string;
  /** When provided, renders a checkbox that toggles complete/incomplete. */
  onToggleComplete?: () => void;
  /** When provided, renders an "Edit" button that opens the item for editing (Phase 3B, Part 8/9). */
  onEdit?: () => void;
  /**
   * Deadline-awareness context (Phase 3A, Part 13) — only rendered when there's something
   * meaningful to say, and only sourced from real data the caller already computed.
   */
  remainingMinutes?: number;
  plannedSessionCount?: number;
  /** Hard/important deadline landing very soon — the one case that earns a stronger visual treatment. */
  urgent?: boolean;
  /** Where the item came from, when it wasn't typed in by hand (Phase 5B). */
  sourceLabel?: string;
  /** Link back to the item in its source system. Opens in a new tab; never fabricated. */
  sourceUrl?: string;
  /**
   * True when the shown duration is a placeholder rather than a real estimate (Phase 5B).
   * Imported work arrives without one, and saying so is better than quietly presenting the
   * placeholder as if the student had chosen it.
   */
  needsEstimate?: boolean;
}

const statusTone: Record<WorkItemStatus, BadgeTone> = {
  "not-started": "neutral",
  "in-progress": "brand",
  completed: "success",
};

const statusLabel: Record<WorkItemStatus, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  completed: "Completed",
};

/** A single row representing an assignment, test, quiz, or project in a list. */
export function TaskRow({
  title,
  subject,
  dueLabel,
  status,
  kindLabel,
  estimatedMinutes,
  className,
  onToggleComplete,
  onEdit,
  remainingMinutes,
  plannedSessionCount,
  urgent,
  sourceLabel,
  sourceUrl,
  needsEstimate,
}: TaskRowProps) {
  const contextParts: string[] = [];
  if (remainingMinutes != null && remainingMinutes > 0 && remainingMinutes !== estimatedMinutes) {
    contextParts.push(`${remainingMinutes} min remaining`);
  }
  if (plannedSessionCount != null && plannedSessionCount > 0) {
    contextParts.push(`${plannedSessionCount} session${plannedSessionCount === 1 ? "" : "s"} planned before deadline`);
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          {onToggleComplete && (
            <input
              type="checkbox"
              checked={status === "completed"}
              onChange={onToggleComplete}
              aria-label={status === "completed" ? `Mark ${title} incomplete` : `Mark ${title} complete`}
              className="h-4 w-4 shrink-0 rounded border-border-strong accent-brand"
            />
          )}
          <span className={cn("truncate text-sm font-medium text-ink", status === "completed" && "line-through text-ink-muted")}>
            {title}
          </span>
          <Badge tone="neutral" className="shrink-0">{kindLabel}</Badge>
          {sourceLabel && <Badge tone="brand" className="shrink-0">{sourceLabel}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
          {subject && <span>{subject}</span>}
          {subject && <span aria-hidden>·</span>}
          <span className={urgent ? "font-medium text-danger" : undefined}>{dueLabel}</span>
          <span aria-hidden>·</span>
          {/* A placeholder duration is labelled as one. Presenting it as "30 min" alongside a real
              student-set estimate would make the two indistinguishable. */}
          <span className={needsEstimate ? "text-warning" : undefined}>
            {needsEstimate ? `${estimatedMinutes} min · estimate needed` : `${estimatedMinutes} min`}
          </span>
          {sourceUrl && (
            <>
              <span aria-hidden>·</span>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-strong underline underline-offset-2 hover:opacity-80"
              >
                Open in Google Classroom
              </a>
            </>
          )}
        </div>
        {contextParts.length > 0 && <p className="text-xs text-ink-faint">{contextParts.join(" · ")}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>
        {onEdit && (
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${title}`}>
            Edit
          </Button>
        )}
      </div>
    </div>
  );
}

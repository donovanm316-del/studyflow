import { Badge, BadgeTone } from "@/components/ui/Badge";
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
}: TaskRowProps) {
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
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          {subject && <span>{subject}</span>}
          {subject && <span aria-hidden>·</span>}
          <span>{dueLabel}</span>
          <span aria-hidden>·</span>
          <span>{estimatedMinutes} min</span>
        </div>
      </div>
      <Badge tone={statusTone[status]} className="shrink-0">
        {statusLabel[status]}
      </Badge>
    </div>
  );
}

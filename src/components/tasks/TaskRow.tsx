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

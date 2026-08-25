import { cn } from "@/lib/utils";

export interface ScheduleBlockCardProps {
  title: string;
  timeLabel: string;
  kind: "assignment" | "test" | "quiz" | "project" | "commitment" | "break" | "free";
  status?: "planned" | "completed" | "skipped";
  /** Short explanation of why this was scheduled here (from `explainPriority`), shown as a subtitle. */
  reason?: string;
  /** Action buttons (mark done, skip, etc.) — the card stays presentation-only, actions are owned by the page. */
  actions?: React.ReactNode;
  className?: string;
}

const kindClasses: Record<ScheduleBlockCardProps["kind"], string> = {
  assignment: "border-l-brand",
  test: "border-l-danger",
  quiz: "border-l-warning",
  project: "border-l-success",
  commitment: "border-l-ink-faint",
  break: "border-l-border-strong",
  free: "border-l-border border-dashed bg-transparent",
};

/** A single scheduled block, as placed by the scheduling engine. */
export function ScheduleBlockCard({ title, timeLabel, kind, status = "planned", reason, actions, className }: ScheduleBlockCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md border border-border border-l-4 bg-surface px-3 py-2",
        kindClasses[kind],
        status === "completed" && "opacity-60",
        status === "skipped" && "opacity-40",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span
            className={cn(
              "text-sm font-medium text-ink",
              status === "completed" && "line-through",
              kind === "free" && "italic text-ink-faint"
            )}
          >
            {title}
          </span>
          <span className="text-xs text-ink-muted">{timeLabel}</span>
        </div>
        {actions}
      </div>
      {reason && <p className="text-xs text-ink-faint">{reason}</p>}
    </div>
  );
}

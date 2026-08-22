import { cn } from "@/lib/utils";

export interface ScheduleBlockCardProps {
  title: string;
  timeLabel: string;
  kind: "assignment" | "test" | "quiz" | "project" | "commitment";
  status?: "planned" | "completed" | "skipped";
  className?: string;
}

const kindClasses: Record<ScheduleBlockCardProps["kind"], string> = {
  assignment: "border-l-brand",
  test: "border-l-danger",
  quiz: "border-l-warning",
  project: "border-l-success",
  commitment: "border-l-ink-faint",
};

/** A single scheduled block, as placed by the scheduling engine (or a placeholder, in Phase 1A). */
export function ScheduleBlockCard({ title, timeLabel, kind, status = "planned", className }: ScheduleBlockCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-md border border-border border-l-4 bg-surface px-3 py-2",
        kindClasses[kind],
        status === "completed" && "opacity-60",
        status === "skipped" && "opacity-40",
        className
      )}
    >
      <span className={cn("text-sm font-medium text-ink", status === "completed" && "line-through")}>
        {title}
      </span>
      <span className="text-xs text-ink-muted">{timeLabel}</span>
    </div>
  );
}

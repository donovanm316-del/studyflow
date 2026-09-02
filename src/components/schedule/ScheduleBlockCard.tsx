import { cn } from "@/lib/utils";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

export interface ScheduleBlockCardProps {
  title: string;
  timeLabel: string;
  kind: "assignment" | "test" | "quiz" | "project" | "commitment" | "break" | "free";
  status?: "planned" | "completed" | "skipped";
  /** Short explanation of why this was scheduled here (from `explainPriority`), shown as a subtitle. */
  reason?: string;
  /**
   * A small honest status flag next to the title — e.g. "Missed" for a still-`planned` block whose
   * time has already passed (Phase 5D, Part 1/8). Text-and-tone, never color alone (Part 22).
   */
  badge?: { label: string; tone: BadgeTone };
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
export function ScheduleBlockCard({ title, timeLabel, kind, status = "planned", reason, badge, actions, className }: ScheduleBlockCardProps) {
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
      {/*
        flex-wrap lets the actions group drop to its own line below the title when the two can't
        fit side by side — the mobile overflow this guarded against was `actions` being marked
        shrink-0 while this row couldn't wrap, so a title-plus-buttons combination wider than the
        viewport had nowhere to go but off the right edge.
      */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "text-sm font-medium text-ink",
                status === "completed" && "line-through",
                kind === "free" && "italic text-ink-faint"
              )}
            >
              {title}
            </span>
            {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
          </span>
          <span className="text-xs text-ink-muted">{timeLabel}</span>
        </div>
        {actions}
      </div>
      {reason && <p className="text-xs text-ink-faint">{reason}</p>}
    </div>
  );
}

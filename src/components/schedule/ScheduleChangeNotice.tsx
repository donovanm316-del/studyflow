import type { ScheduleChangeSummary, WorkItemScheduleChange } from "@/scheduling-engine";

/**
 * Reports the outcome of a schedule preview/diff — real engine output, rendered verbatim.
 *
 * Shared by every place that changes an item and needs to say what happened to the schedule as a
 * result (Google Classroom sync, and the estimate-needed quick-entry flow): both compute their
 * result with the same `previewSyncImpact`/`diffSchedules` pipeline the rest of StudyFlow already
 * uses, so this component only ever has to render `ScheduleChangeSummary`, never compose an
 * explanation of its own (Phase 5C, Part 13).
 *
 * Always renders something once `summary` is non-null: either the real changes, or an explicit "no
 * change needed" — silence here would leave the student unsure whether anything happened at all.
 */

const CHANGE_LABEL: Record<WorkItemScheduleChange["kind"], string> = {
  added: "Added",
  removed: "Removed",
  moved: "Moved",
  "duration-changed": "Time changed",
};

export function ScheduleChangeNotice({ summary }: { summary: ScheduleChangeSummary }) {
  if (summary.changes.length === 0) {
    return (
      <p className="mt-3 rounded-md border border-border bg-paper px-3 py-2 text-xs text-ink-muted">
        Your schedule did not need to change.
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-paper px-3 py-2">
      <p className="mb-1 text-xs font-medium text-ink">Schedule updated</p>
      <ul className="flex flex-col gap-0.5 text-xs text-ink-muted">
        {summary.changes.slice(0, 6).map((change) => (
          <li key={change.workItemId} className="break-words">
            {CHANGE_LABEL[change.kind]} · {change.title}
            {change.after && <span className="text-ink-faint"> → {change.after}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

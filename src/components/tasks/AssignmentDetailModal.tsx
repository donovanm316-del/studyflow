"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { summarizeBuffer, recommendStartDate } from "@/lib/decision-support";
import { blockMatchesWorkItem, formatDueLabel } from "@/lib/schedule-format";
import { formatMinutesAsHoursMinutes, weekdayName, type GenerateScheduleResult, type SchedulableWorkItem } from "@/scheduling-engine";
import type { WorkStage } from "@/types/models";

/**
 * "View assignment details" (Phase 5C, Part 5) — the ownership split made concrete for one item.
 *
 * Everything under "From Google Classroom" is exactly what the source supplied: title (shown as the
 * modal heading), course, deadline, description, and link — refreshed automatically on sync, never
 * edited here. Everything under "Your StudyFlow plan" is read from the same `GenerateScheduleResult`
 * every other page uses (`summarizeBuffer`, `recommendStartDate`, the real planned-session count) —
 * there is no separate calculation for this view.
 */
export interface AssignmentDetailModalProps {
  open: boolean;
  onClose: () => void;
  item: SchedulableWorkItem;
  result: GenerateScheduleResult;
  stages: WorkStage[];
  today: string;
  onEdit: () => void;
}

export function AssignmentDetailModal({ open, onClose, item, result, stages, today, onEdit }: AssignmentDetailModalProps) {
  const isClassroom = item.source === "google-classroom";
  const capacity = result.deadlineCapacities[item.id];
  const buffer = capacity ? summarizeBuffer(capacity) : null;
  const startRecommendation = recommendStartDate(item, result, stages);
  const plannedSessionCount = result.blocks.filter((b) => blockMatchesWorkItem(b, item.id, stages) && b.status === "planned").length;

  return (
    <Modal open={open} onClose={onClose} title={item.title}>
      <div className="flex flex-col gap-4">
        {isClassroom && (
          <section className="rounded-md border border-brand-soft bg-brand-soft px-3 py-2">
            <Badge tone="brand">From Google Classroom</Badge>
            <dl className="mt-2 flex flex-col gap-1 text-xs">
              {item.subject && (
                <div>
                  <dt className="inline font-medium text-brand-strong">Course: </dt>
                  <dd className="inline text-ink-muted">{item.subject}</dd>
                </div>
              )}
              <div>
                <dt className="inline font-medium text-brand-strong">Classroom deadline: </dt>
                <dd className="inline text-ink-muted">{formatDueLabel(item.dueDate, today)}</dd>
              </div>
            </dl>
            {item.sourceDescription && (
              <p className="mt-2 whitespace-pre-wrap break-words text-xs text-ink-muted">{item.sourceDescription}</p>
            )}
            {item.externalUrl && (
              <a
                href={item.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-brand-strong underline underline-offset-2 hover:opacity-80"
              >
                Open in Google Classroom
              </a>
            )}
          </section>
        )}

        <section className="rounded-md border border-border-strong bg-paper px-3 py-2">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Your StudyFlow plan</p>
          <dl className="flex flex-col gap-1 text-xs">
            <div>
              <dt className="inline font-medium text-ink-faint">Estimate: </dt>
              <dd className="inline text-ink">
                {formatMinutesAsHoursMinutes(item.estimatedMinutes)}
                {item.needsEstimate && <span className="ml-1 text-warning">(still needed)</span>}
              </dd>
            </div>
            {plannedSessionCount > 0 && (
              <div>
                <dt className="inline font-medium text-ink-faint">Sessions planned: </dt>
                <dd className="inline text-ink">{plannedSessionCount}</dd>
              </div>
            )}
            {startRecommendation && (
              <div>
                <dt className="inline font-medium text-ink-faint">Starts: </dt>
                <dd className="inline text-ink">{weekdayName(startRecommendation.startDate)}</dd>
              </div>
            )}
          </dl>
          {buffer && buffer.capacity.estimatedMinutes > 0 && (
            <p className="mt-2 text-xs">
              <span aria-hidden>{buffer.icon}</span> <span className="font-medium text-ink">{buffer.label}</span> —{" "}
              <span className="text-ink-muted">{buffer.sentence}</span>
            </p>
          )}
        </section>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onEdit}>Edit your plan</Button>
        </div>
      </div>
    </Modal>
  );
}

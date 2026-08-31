"use client";

import { Fragment, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { formatMinutesAsHoursMinutes, type DeadlineRiskLevel, type SchedulableWorkItem } from "@/scheduling-engine";
import { formatDueLabel } from "@/lib/schedule-format";
import type { CourseWorkload } from "@/lib/classroom-insights";

/**
 * "Is my workload concentrated in one class?" (Phase 5C, Part 3) — a plain table over real
 * per-course numbers, not a second workload algorithm. Every figure comes from
 * `courseWorkloadBreakdown`, which itself only reads the engine's own `deadlineCapacities`.
 */

const RISK_LABEL: Record<DeadlineRiskLevel, string> = {
  comfortable: "Comfortable",
  tight: "Tight",
  "at-risk": "At risk",
  overdue: "Overdue",
};

const RISK_TONE: Record<DeadlineRiskLevel, BadgeTone> = {
  comfortable: "success",
  tight: "warning",
  "at-risk": "danger",
  overdue: "danger",
};

export interface CourseWorkloadTableProps {
  breakdown: CourseWorkload[];
  workItems: SchedulableWorkItem[];
  today: string;
  /** The same cutoff `courseWorkloadBreakdown` was called with — so the expanded list of "due soon" items matches the count shown in the row. */
  dueSoonCutoff: string;
  /** Real weekday name from `courseConcentrationDay`, keyed by subject — absent means no real concentration to report. */
  concentrationDayBySubject: Record<string, string | null>;
}

export function CourseWorkloadTable({ breakdown, workItems, today, dueSoonCutoff, concentrationDayBySubject }: CourseWorkloadTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (breakdown.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-ink-faint">
            <th className="py-2 pr-3 font-medium">Course</th>
            <th className="py-2 pr-3 font-medium">Work remaining</th>
            <th className="py-2 pr-3 font-medium">Due soon</th>
            <th className="py-2 font-medium">Risk</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((course) => {
            const isOpen = expanded === course.subject;
            const items = workItems.filter((i) => course.itemIds.includes(i.id));
            const dueSoonItems = items.filter((i) => i.dueDate.slice(0, 10) <= dueSoonCutoff).slice(0, 5);
            const concentration = concentrationDayBySubject[course.subject];

            return (
              <Fragment key={course.subject}>
                <tr
                  className="cursor-pointer border-b border-border last:border-b-0 hover:bg-paper"
                  onClick={() => setExpanded(isOpen ? null : course.subject)}
                  aria-expanded={isOpen}
                >
                  <td className="py-2 pr-3">
                    <button
                      className="text-left font-medium text-ink underline-offset-2 hover:underline"
                      aria-label={`${isOpen ? "Collapse" : "Expand"} ${course.subject}`}
                    >
                      {course.subject}
                    </button>
                  </td>
                  <td className="py-2 pr-3 text-ink-muted">{formatMinutesAsHoursMinutes(course.remainingMinutes)}</td>
                  <td className="py-2 pr-3 text-ink-muted">{course.dueSoonCount}</td>
                  <td className="py-2">
                    <Badge tone={RISK_TONE[course.risk]}>{RISK_LABEL[course.risk]}</Badge>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-border bg-paper last:border-b-0">
                    <td colSpan={4} className="px-1 py-3 text-xs text-ink-muted">
                      <div className="flex flex-col gap-2">
                        {course.nextDeadline && (
                          <p>
                            Next deadline: <span className="text-ink">{formatDueLabel(course.nextDeadline, today)}</span>
                          </p>
                        )}
                        {concentration && (
                          <p>
                            Most of this course&apos;s scheduled work falls on <span className="text-ink">{concentration}</span>.
                          </p>
                        )}
                        {dueSoonItems.length > 0 && (
                          <ul className="flex flex-col gap-0.5">
                            {dueSoonItems.map((item) => (
                              <li key={item.id} className="truncate">
                                {item.title}
                              </li>
                            ))}
                          </ul>
                        )}
                        {course.classroomUrl && (
                          <a
                            href={course.classroomUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-fit text-brand-strong underline underline-offset-2 hover:opacity-80"
                          >
                            Open in Google Classroom
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

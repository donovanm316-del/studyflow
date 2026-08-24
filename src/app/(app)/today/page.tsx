"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ScheduleBlockCard } from "@/components/schedule/ScheduleBlockCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAppData } from "@/lib/data/store";
import { useSchedule } from "@/lib/data/useSchedule";
import { blockCardKind, formatTimeRange } from "@/lib/schedule-format";
import { currentWeekRange, todayDateOnly } from "@/lib/now";
import type { ScheduleBlock } from "@/types/models";

export default function TodayPage() {
  const today = todayDateOnly();
  // Plan over the whole week (same horizon as the Schedule page) so an "early" work style can
  // legitimately start today on something due later this week — a 1-day range would only ever
  // surface work whose due date is today or already overdue.
  const { start, end } = currentWeekRange();
  const result = useSchedule(start, end);
  const { completeBlock, skipBlock, moveBlock } = useAppData();
  const [completing, setCompleting] = useState<{ block: ScheduleBlock; minutes: number } | null>(null);

  const todaysBlocks = result.blocks.filter((b) => b.start.slice(0, 10) === today);

  function plannedMinutes(block: ScheduleBlock): number {
    const [sh, sm] = block.start.split("T")[1].split(":").map(Number);
    const [eh, em] = block.end.split("T")[1].split(":").map(Number);
    return eh * 60 + em - (sh * 60 + sm);
  }

  function moveToTomorrow(block: ScheduleBlock) {
    const shift = (iso: string) => {
      const [date, time] = iso.split("T");
      const [y, m, d] = date.split("-").map(Number);
      const next = new Date(y, m - 1, d + 1);
      const nextDate = `${next.getFullYear()}-${(next.getMonth() + 1).toString().padStart(2, "0")}-${next.getDate().toString().padStart(2, "0")}`;
      return `${nextDate}T${time}`;
    };
    moveBlock(block, shift(block.start), shift(block.end));
  }

  return (
    <div>
      <PageHeader title="Today" description="Your generated plan for today, from the scheduling engine." />

      {result.caughtUp && todaysBlocks.filter((b) => b.origin === "generated").length === 0 && (
        <div className="mb-4 rounded-md border border-success-soft bg-success-soft px-4 py-3 text-sm text-success">
          You&apos;re caught up — no work is required today beyond what&apos;s already planned.
        </div>
      )}

      {result.warnings.map((w) => (
        <div key={w.kind} className="mb-4 rounded-md border border-warning-soft bg-warning-soft px-4 py-3 text-sm text-warning">
          {w.message}
        </div>
      ))}

      <section className="rounded-lg border border-border bg-surface p-5">
        {todaysBlocks.length === 0 ? (
          <EmptyState title="Nothing scheduled today" description="Add assignments, tests, or commitments to generate a plan." />
        ) : (
          <div className="flex flex-col gap-2">
            {todaysBlocks.map((block) => {
              const isWork = block.origin === "generated" || block.origin === "manual-override";
              return (
                <ScheduleBlockCard
                  key={block.id}
                  title={block.title}
                  timeLabel={formatTimeRange(block)}
                  kind={blockCardKind(block)}
                  status={block.status}
                  reason={block.reason}
                  actions={
                    isWork && block.status === "planned" ? (
                      <div className="flex shrink-0 gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setCompleting({ block, minutes: plannedMinutes(block) })}>
                          Done
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => moveToTomorrow(block)}>
                          Move to tomorrow
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => skipBlock(block)}>
                          Skip
                        </Button>
                      </div>
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </section>

      {completing && (
        <div className="mt-4 flex items-end gap-3 rounded-lg border border-border bg-surface p-4">
          <Input
            label={`Actual minutes spent on "${completing.block.title}"`}
            type="number"
            min={1}
            value={completing.minutes}
            onChange={(e) => setCompleting({ ...completing, minutes: Number(e.target.value) })}
          />
          <Button
            onClick={() => {
              completeBlock(completing.block, completing.minutes);
              setCompleting(null);
            }}
          >
            Confirm
          </Button>
          <Button variant="ghost" onClick={() => setCompleting(null)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

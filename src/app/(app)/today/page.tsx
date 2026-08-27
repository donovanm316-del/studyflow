"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ScheduleBlockCard } from "@/components/schedule/ScheduleBlockCard";
import { WorkloadStatusBadge } from "@/components/schedule/WorkloadStatusBadge";
import { NextUpCard } from "@/components/schedule/NextUpCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAppData } from "@/lib/data/store";
import { useSchedule } from "@/lib/data/useSchedule";
import { blockCardKind, formatTimeRange } from "@/lib/schedule-format";
import { currentWeekRange, todayDateOnly } from "@/lib/now";
import { nowLocalIso } from "@/lib/now";
import { getNextBestAction } from "@/lib/next-best-action";
import { diffSchedules, minutesOfDay, subtractIntervals, type ScheduleChangeSummary, type TimeWindow } from "@/scheduling-engine";
import type { ScheduleBlock, WorkSession } from "@/types/models";

type CompletionStep =
  | { stage: "minutes"; source: { kind: "block"; block: ScheduleBlock } | { kind: "adhoc" }; minutes: number }
  | {
      stage: "feeling";
      source: { kind: "block"; block: ScheduleBlock } | { kind: "adhoc" };
      minutes: number;
    };

/** Only ever called from event handlers or effect callbacks, never during render — see the
 *  `liveElapsedMinutes` state below, which is what render actually reads. */
function computeElapsedMinutes(startedAt: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60_000));
}

function formatClockTime(isoDateTime: string): string {
  const [h, m] = isoDateTime.split("T")[1].split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

export default function TodayPage() {
  const today = todayDateOnly();
  // Plan over the whole week (same horizon as the Schedule page) so an "early" work style can
  // legitimately start today on something due later this week — a 1-day range would only ever
  // surface work whose due date is today or already overdue.
  const { start, end } = currentWeekRange();
  const result = useSchedule(start, end);
  const {
    planningProfile,
    activeSession,
    completeBlock,
    moveBlock,
    replanRemainingToday,
    startSession,
    startAdHocSession,
    cancelActiveSession,
    completeAdHocSession,
  } = useAppData();

  const [completion, setCompletion] = useState<CompletionStep | null>(null);
  const [chooserBlockId, setChooserBlockId] = useState<string | null>(null);
  const [replanNotice, setReplanNotice] = useState<string | null>(null);
  const [expandedWhyId, setExpandedWhyId] = useState<string | null>(null);
  // Captures the schedule right before a replanning action; once the store update lands and
  // `result` reflects it, this derives the change summary (Phase 3B, Part 6/7). Cleared together
  // with `replanNotice` when the student dismisses the banner.
  const [diffBaseline, setDiffBaseline] = useState<ScheduleBlock[] | null>(null);
  const changeSummary: ScheduleChangeSummary | null = useMemo(
    () => (diffBaseline ? diffSchedules(diffBaseline, result.blocks) : null),
    [diffBaseline, result]
  );
  // Wall-clock reads (Date.now()) must happen in an effect, not during render — this keeps the
  // "N min so far" display live (refreshed every 30s) without the render function itself being
  // impure. `elapsedMinutesRef` (via callback below) is only ever read from event handlers.
  const [liveElapsedMinutes, setLiveElapsedMinutes] = useState(0);

  useEffect(() => {
    if (!activeSession) return;
    const update = () => setLiveElapsedMinutes(computeElapsedMinutes(activeSession.startedAt));
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [activeSession]);

  const todaysBlocks = result.blocks.filter((b) => b.start.slice(0, 10) === today && b.status !== "skipped");

  const dow = (() => {
    const [y, m, d] = today.split("-").map(Number);
    return new Date(y, m - 1, d).getDay();
  })();
  const availability = planningProfile.dailyAvailability.find((a) => a.dayOfWeek === dow);
  const dayWindow: TimeWindow | null = availability
    ? { startMinute: minutesOfDay(availability.earliest), endMinute: minutesOfDay(availability.latest) }
    : null;
  const busy: TimeWindow[] = todaysBlocks.map((b) => ({
    startMinute: minutesOfDay(b.start.split("T")[1]),
    endMinute: minutesOfDay(b.end.split("T")[1]),
  }));
  const freeWindows = dayWindow ? subtractIntervals(dayWindow, busy).filter((w) => w.endMinute - w.startMinute >= 15) : [];

  type Entry =
    | { key: string; startMinute: number; kind: "block"; block: ScheduleBlock }
    | { key: string; startMinute: number; kind: "free"; window: TimeWindow };
  const entries: Entry[] = [
    ...todaysBlocks.map((b) => ({ key: b.id, startMinute: minutesOfDay(b.start.split("T")[1]), kind: "block" as const, block: b })),
    ...freeWindows.map((w, i) => ({ key: `free-${i}`, startMinute: w.startMinute, kind: "free" as const, window: w })),
  ].sort((a, b) => a.startMinute - b.startMinute);

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
    setDiffBaseline(result.blocks);
    moveBlock(block, shift(block.start), shift(block.end));
    setChooserBlockId(null);
    setReplanNotice(`Moved "${block.title}" to tomorrow.`);
  }

  function doReplanRemainingToday(block: ScheduleBlock) {
    setDiffBaseline(result.blocks);
    replanRemainingToday(block);
    setChooserBlockId(null);
    setReplanNotice("Your remaining schedule for today has been recalculated.");
  }

  function beginFinish(source: CompletionStep["source"], defaultMinutes: number) {
    setCompletion({ stage: "minutes", source, minutes: defaultMinutes });
  }

  function confirmMinutes() {
    if (!completion) return;
    setCompletion({ ...completion, stage: "feeling" });
  }

  function finalizeCompletion(estimateFeedback?: WorkSession["estimateFeedback"]) {
    if (!completion) return;
    if (completion.source.kind === "block") {
      completeBlock(completion.source.block, completion.minutes, estimateFeedback);
    } else {
      completeAdHocSession(completion.minutes, estimateFeedback);
    }
    setCompletion(null);
  }

  const workAhead = result.workAheadSuggestions.filter((s) => s.type === "work-ahead");
  const review = result.workAheadSuggestions.filter((s) => s.type === "review");
  const showCaughtUpPanel = result.caughtUp && todaysBlocks.filter((b) => b.origin === "generated").length === 0;

  // "Next best action" (Phase 4, Part 15-18) — reads the same `result` the timeline below already
  // renders, so it can never disagree with what's actually on the schedule. Recomputed only when
  // the schedule or active session actually changes, not on every render.
  const nextAction = useMemo(() => getNextBestAction(result, activeSession, nowLocalIso()), [result, activeSession]);

  return (
    <div>
      <PageHeader title="Today" description="Your day, as a timeline — fixed commitments, work sessions, breaks, and free time." />

      <div className="mb-4">
        <WorkloadStatusBadge status={result.workloadStatus} />
      </div>

      {result.warnings.map((w) => (
        <div key={w.kind} className="mb-4 rounded-md border border-warning-soft bg-warning-soft px-4 py-3 text-sm text-warning">
          {w.message}
        </div>
      ))}

      {replanNotice && (
        <div className="mb-4 rounded-md border border-brand-soft bg-brand-soft px-4 py-3 text-sm text-brand-strong">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">Schedule updated</span>
            <button
              onClick={() => {
                setReplanNotice(null);
                setDiffBaseline(null);
              }}
              aria-label="Dismiss"
              className="text-brand-strong hover:opacity-70"
            >
              ✕
            </button>
          </div>
          <p className="mt-1">{replanNotice}</p>
          {changeSummary && changeSummary.changes.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 border-t border-brand-soft pt-2">
              {changeSummary.changes.map((c) => (
                <li key={c.workItemId} className="text-xs">
                  <span className="font-medium">{c.title}</span>{" "}
                  {c.kind === "added" && <>— now scheduled ({c.after})</>}
                  {c.kind === "removed" && <>— no longer scheduled this week</>}
                  {c.kind === "moved" && <>— moved to {c.after}</>}
                  {c.kind === "duration-changed" && <>— now {c.after} (was {c.before})</>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeSession && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand bg-brand-soft px-4 py-3">
          <div>
            <p className="text-sm font-medium text-ink">Working on &ldquo;{activeSession.workItemTitle}&rdquo;</p>
            <p className="text-xs text-ink-muted">
              Started at {formatClockTime(activeSession.startedAt)} · {liveElapsedMinutes} min so far
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                const activeBlock = activeSession.blockId ? result.blocks.find((b) => b.id === activeSession.blockId) : undefined;
                beginFinish(
                  activeBlock ? { kind: "block", block: activeBlock } : { kind: "adhoc" },
                  computeElapsedMinutes(activeSession.startedAt) || 1
                );
              }}
            >
              Finish
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelActiveSession}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!activeSession &&
        (nextAction.kind === "scheduled" || (nextAction.kind === "no-work" && !showCaughtUpPanel)) && (
          <div className="mb-4">
            <NextUpCard action={nextAction} onStart={nextAction.kind === "scheduled" ? () => startSession(nextAction.block) : undefined} />
          </div>
        )}

      {showCaughtUpPanel && (
        <div className="mb-4 rounded-md border border-success-soft bg-success-soft px-4 py-3 text-sm text-success">
          <p className="font-medium">You&apos;re caught up — no work is required today beyond what&apos;s already planned.</p>
          {(workAhead.length > 0 || review.length > 0) && (
            <div className="mt-3 flex flex-col gap-2">
              {review.map((s) => (
                <div key={s.workItemId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success-soft bg-surface px-3 py-2">
                  <span className="text-sm text-ink">{s.reason}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!!activeSession}
                    onClick={() => startAdHocSession(s.workItemId, `Review: ${s.title}`)}
                  >
                    Review now
                  </Button>
                </div>
              ))}
              {workAhead.map((s) => (
                <div key={s.workItemId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-success-soft bg-surface px-3 py-2">
                  <span className="text-sm text-ink">{s.reason}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!!activeSession}
                    onClick={() => startAdHocSession(s.workItemId, s.title)}
                  >
                    Work ahead
                  </Button>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-success">
            Or just keep this time free — nothing here is required.
          </p>
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface p-5">
        {entries.length === 0 ? (
          <EmptyState title="Nothing scheduled yet" description="Add some assignments or tests and StudyFlow will build your first day." />
        ) : (
          <div className="flex flex-col gap-2">
            {entries.map((entry) => {
              if (entry.kind === "free") {
                return (
                  <ScheduleBlockCard
                    key={entry.key}
                    title="Free time"
                    timeLabel={`${minutesLabel(entry.window.startMinute)} – ${minutesLabel(entry.window.endMinute)}`}
                    kind="free"
                  />
                );
              }

              const block = entry.block;
              const isWork = block.origin === "generated" || block.origin === "manual-override";
              const isActive = activeSession?.blockId === block.id;
              const isChoosing = chooserBlockId === block.id;
              const explanation = block.workItemId ? result.decisionExplanations[block.workItemId] : undefined;
              const isWhyExpanded = expandedWhyId === block.id;

              return (
                <div key={block.id} className="flex flex-col gap-2">
                  <ScheduleBlockCard
                    title={block.title}
                    timeLabel={formatTimeRange(block)}
                    kind={blockCardKind(block)}
                    status={block.status}
                    reason={block.reason}
                    actions={
                      isWork && block.status === "planned" && !isActive ? (
                        <div className="flex shrink-0 flex-wrap items-center gap-1">
                          <Button size="sm" disabled={!!activeSession} onClick={() => startSession(block)}>
                            Start
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => beginFinish({ kind: "block", block }, plannedMinutes(block))}>
                            Log without timer
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setChooserBlockId(isChoosing ? null : block.id)}>
                            Can&apos;t do this today
                          </Button>
                        </div>
                      ) : isWork && isActive ? (
                        <span className="shrink-0 text-xs font-medium text-brand">Working…</span>
                      ) : undefined
                    }
                  />
                  {explanation && block.status === "planned" && (
                    <div className="ml-2">
                      <button
                        onClick={() => setExpandedWhyId(isWhyExpanded ? null : block.id)}
                        aria-expanded={isWhyExpanded}
                        className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                      >
                        {isWhyExpanded ? "Hide reason" : "Why today?"}
                      </button>
                      {isWhyExpanded && (
                        <ul className="mt-1 flex flex-col gap-0.5 rounded-md border border-dashed border-border-strong bg-paper px-3 py-2">
                          {explanation.bullets.map((bullet, i) => (
                            <li key={i} className="text-xs text-ink-muted">• {bullet}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {isChoosing && (
                    <div className="ml-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border-strong bg-paper px-3 py-2">
                      <span className="text-xs text-ink-muted">What should happen to &ldquo;{block.title}&rdquo;?</span>
                      <Button size="sm" variant="secondary" onClick={() => moveToTomorrow(block)}>
                        Move just this session to tomorrow
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => doReplanRemainingToday(block)}>
                        Re-plan the rest of today
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setChooserBlockId(null)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {completion?.stage === "minutes" && (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
          <Input
            label="Actual minutes spent"
            type="number"
            min={1}
            value={completion.minutes}
            onChange={(e) => setCompletion({ ...completion, minutes: Number(e.target.value) })}
          />
          <Button onClick={confirmMinutes}>Continue</Button>
          <Button variant="ghost" onClick={() => setCompletion(null)}>Cancel</Button>
        </div>
      )}

      {completion?.stage === "feeling" && (
        <div className="mt-4 rounded-lg border border-border bg-surface p-4">
          <p className="mb-3 text-sm font-medium text-ink">How did that estimate feel?</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => finalizeCompletion("much-faster")}>Much faster than expected</Button>
            <Button size="sm" variant="secondary" onClick={() => finalizeCompletion("about-right")}>About right</Button>
            <Button size="sm" variant="secondary" onClick={() => finalizeCompletion("took-longer")}>Took longer than expected</Button>
            <Button size="sm" variant="ghost" onClick={() => finalizeCompletion(undefined)}>Skip</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function minutesLabel(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

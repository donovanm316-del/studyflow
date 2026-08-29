/**
 * "What should I work on next?" (Phase 4, Part 15-24). Deliberately not a second scheduling
 * engine — this only *reads* what `generateSchedule` already produced and picks out the single
 * most relevant thing to show the student, the same way a human would glance at their own
 * timeline. Dashboard, Today, and Schedule all call this with the schedule they already computed
 * for the same date range, so they always agree (Part 22) without any extra plumbing.
 */
import { blockDurationMinutes, formatMinutesAsHoursMinutes, minutesOfDay, toDateOnly } from "@/scheduling-engine";
import type { GenerateScheduleResult, WorkAheadSuggestion } from "@/scheduling-engine";
import { buildWhyNow, freeMinutesToday, summarizeBuffer, type BufferSummary } from "@/lib/decision-support";
import { formatDueLabel } from "@/lib/schedule-format";
import type { ActiveWorkSession, ScheduleBlock } from "@/types/models";

export type NextBestAction =
  | { kind: "current-session"; title: string; startedAt: string; plannedMinutes?: number }
  | {
      kind: "scheduled";
      block: ScheduleBlock;
      minutesLabel: string;
      primaryReason?: string;
      reasonBullets: string[];
      after: { title: string; minutesLabel: string } | null;
      /** Deadline context for the recommended work, when the engine computed it (Phase 4.5B). */
      dueLabel: string | null;
      buffer: BufferSummary | null;
      /** Present-tense "why this, now" reasons — see `buildWhyNow`. */
      whyNow: string[];
    }
  | { kind: "no-work"; message: string; optional: WorkAheadSuggestion[]; freeMinutes: number };

function isWorkBlock(block: ScheduleBlock): boolean {
  return (block.origin === "generated" || block.origin === "manual-override") && block.status === "planned" && !!block.workItemId;
}

/**
 * A currently active session always wins (Part 17) — it is not competing with the next
 * recommendation, it *is* the current one. Otherwise, the next best action is simply the
 * chronologically-next not-yet-completed work block on the schedule: the engine already resolved
 * priority/urgency/capacity conflicts when it decided what to place and when, so the earliest
 * remaining block is also the highest-priority thing that's actually schedulable right now.
 */
export function getNextBestAction(
  result: GenerateScheduleResult,
  activeSession: ActiveWorkSession | null,
  nowIso: string
): NextBestAction {
  if (activeSession) {
    return {
      kind: "current-session",
      title: activeSession.workItemTitle,
      startedAt: activeSession.startedAt,
      plannedMinutes: activeSession.plannedMinutes,
    };
  }

  const today = toDateOnly(nowIso);
  const nowMinute = minutesOfDay(nowIso.split("T")[1]);

  const candidates = result.blocks
    .filter(isWorkBlock)
    .filter((b) => {
      const date = toDateOnly(b.start);
      if (date > today) return true;
      if (date < today) return false;
      // Today: only a block that hasn't already finished — a session already over by the clock
      // isn't "next", it's something the student didn't get to yet and can find on the timeline.
      return minutesOfDay(b.start.split("T")[1]) + blockDurationMinutes(b.start, b.end) > nowMinute;
    })
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const next = candidates[0];
  if (!next) {
    return {
      kind: "no-work",
      message: result.caughtUp ? "You're caught up." : "Nothing else is scheduled today.",
      optional: result.caughtUp ? result.workAheadSuggestions : [],
      // Free time is a real, protected outcome worth naming — not empty space to fill (Part 11).
      freeMinutes: freeMinutesToday(result, nowIso),
    };
  }

  const afterBlock = candidates[1];
  const explanation = next.workItemId ? result.decisionExplanations[next.workItemId] : undefined;
  const capacity = next.workItemId ? result.deadlineCapacities[next.workItemId] : undefined;

  return {
    kind: "scheduled",
    block: next,
    minutesLabel: formatMinutesAsHoursMinutes(blockDurationMinutes(next.start, next.end)),
    primaryReason: explanation?.primaryReason,
    reasonBullets: explanation?.bullets ?? [],
    after: afterBlock
      ? { title: afterBlock.title, minutesLabel: formatMinutesAsHoursMinutes(blockDurationMinutes(afterBlock.start, afterBlock.end)) }
      : null,
    dueLabel: capacity ? formatDueLabel(capacity.deadline, today) : null,
    buffer: capacity ? summarizeBuffer(capacity) : null,
    whyNow: buildWhyNow(next, result, nowIso),
  };
}

/**
 * Orchestrates priority scoring, availability, capacity, and task splitting into an actual
 * schedule (Part 13). This is the only file that decides *when* things happen — every other
 * module in this directory answers a narrower question (how urgent, how much room, how to
 * split) that this file combines.
 *
 * Algorithm, in one paragraph: score every not-yet-due-out-of-range-excluded work item with
 * `calculatePriority`; walk items highest score first; for each, offer it the day slots inside
 * its schedulable window (today..min(rangeEnd, dueDate), reordered per `workStyle`) and let
 * `splitTask` carve out chunks bounded by session length and the day's soft capacity; mutate a
 * shared per-day availability/capacity ledger as chunks land so lower-priority items see less
 * room. No randomness, no clock reads beyond the `now` the caller supplies — same inputs always
 * produce the same output.
 */
import {
  BREAK_LENGTH_MINUTES,
  EARLY_FRONT_LOAD_FACTOR,
  MIN_CHUNK_MINUTES,
  URGENT_PROTECTION_HORIZON_DAYS,
  WORK_AHEAD_HORIZON_DAYS,
} from "./constants";
import { calculateDailyCapacity, calculateFeedbackAdjustment } from "./capacity";
import { findAvailableWindows, subtractIntervals, type TimeWindow } from "./availability";
import { calculatePriority, explainPriority } from "./priority";
import { isSplittableWorkType, sessionBounds, splitTask, type DaySlot, type PlannedChunk } from "./splitting";
import { combineDateAndMinutes, dateRange, diffInDays, toDateOnly } from "./date-utils";
import type {
  GenerateScheduleInput,
  GenerateScheduleResult,
  PriorityBreakdown,
  ReplanInput,
  ScheduleWarning,
  SchedulableWorkItem,
  WorkAheadSuggestion,
} from "./types";
import type { CourseRigor, ScheduleBlock } from "@/types/models";

interface DayState {
  windows: TimeWindow[];
  capacityRemaining: number;
}

/**
 * Deterministic id derived from what's being placed, not a counter — so two calls with
 * identical inputs produce byte-identical output, and re-running is safe/idempotent.
 */
function chunkBlockId(userId: string, workItemId: string, date: string, startMinute: number): string {
  return `block_${userId}_${workItemId}_${date}_${startMinute}`;
}
function breakBlockId(userId: string, date: string, startMinute: number): string {
  return `break_${userId}_${date}_${startMinute}`;
}

export function generateSchedule(input: GenerateScheduleInput): GenerateScheduleResult {
  const { userId, rangeStart, rangeEnd, now, planningProfile, commitments } = input;
  const existingBlocks = input.existingBlocks ?? [];
  const preservedBlocks = existingBlocks.filter(
    (b) => b.status === "completed" || b.status === "skipped" || b.origin === "manual-override"
  );

  const today = toDateOnly(now);
  const notCompleted = input.workItems.filter((item) => item.status !== "completed");

  const inRange = notCompleted.filter(
    (item) => toDateOnly(item.dueDate) <= rangeEnd || diffInDays(now, item.dueDate) <= 0
  );
  const outOfRangeSoon = notCompleted.filter(
    (item) =>
      toDateOnly(item.dueDate) > rangeEnd &&
      diffInDays(now, item.dueDate) > 0 &&
      diffInDays(now, item.dueDate) <= WORK_AHEAD_HORIZON_DAYS
  );

  const remainingOf = (item: SchedulableWorkItem) => Math.max(0, item.estimatedMinutes - (item.actualMinutes ?? 0));

  const isBehind = inRange.some((item) => diffInDays(now, item.dueDate) <= 0 && remainingOf(item) > 0);
  const relevantRigors: CourseRigor[] = inRange
    .map((item) => item.rigor)
    .filter((r): r is CourseRigor => !!r);

  const feedbackAdjustment = calculateFeedbackAdjustment(input.feedback ?? []);
  const capacityContext = { relevantRigors, isBehind, feedbackAdjustment };
  const dailyCapacityMinutes = calculateDailyCapacity(planningProfile, capacityContext);
  const dates = dateRange(rangeStart, rangeEnd);

  const dayState = new Map<string, DayState>();
  for (const date of dates) {
    dayState.set(date, {
      windows: findAvailableWindows(date, planningProfile, commitments, existingBlocks),
      capacityRemaining: dailyCapacityMinutes,
    });
  }

  // Priorities are computed for every not-yet-completed item (in and out of range) so callers
  // like the Dashboard can show an explainable ranking even for work this call doesn't place.
  const priorities: Record<string, PriorityBreakdown> = {};
  for (const item of notCompleted) {
    priorities[item.id] = calculatePriority(item, { now, remainingMinutes: remainingOf(item) });
  }

  // Placement order: near-term deadlines are protected first (see URGENT_PROTECTION_HORIZON_DAYS),
  // then everything else by priority score. This keeps a big, high-scoring-but-flexible item from
  // greedily eating the shared capacity ledger before a tiny, nearly-inflexible item due tomorrow
  // gets a chance at it.
  const schedulable = inRange
    .map((item) => ({ item, remainingMinutes: remainingOf(item), slackDays: diffInDays(now, item.dueDate) }))
    .filter((entry) => entry.remainingMinutes > 0)
    .sort((a, b) => {
      const aUrgent = a.slackDays <= URGENT_PROTECTION_HORIZON_DAYS;
      const bUrgent = b.slackDays <= URGENT_PROTECTION_HORIZON_DAYS;
      if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;
      if (aUrgent && bUrgent && a.slackDays !== b.slackDays) return a.slackDays - b.slackDays;

      const scoreDiff = priorities[b.item.id].score - priorities[a.item.id].score;
      if (scoreDiff !== 0) return scoreDiff;
      if (a.item.dueDate !== b.item.dueDate) return a.item.dueDate < b.item.dueDate ? -1 : 1;
      return a.item.id < b.item.id ? -1 : 1;
    });

  const totalAvailableMinutes = dates.reduce((sum, date) => {
    const state = dayState.get(date)!;
    const windowMinutes = state.windows.reduce((s, w) => s + (w.endMinute - w.startMinute), 0);
    return sum + Math.min(windowMinutes, dailyCapacityMinutes);
  }, 0);

  const newBlocks: ScheduleBlock[] = [];
  const breakEntries: PlannedChunk[] = [];
  const unscheduledWorkItemIds: string[] = [];
  const bounds = sessionBounds(planningProfile.breakPreference);
  const startDate = rangeStart > today ? rangeStart : today;

  for (const { item, remainingMinutes } of schedulable) {
    const dueDateOnly = toDateOnly(item.dueDate);
    const isOverdueItem = diffInDays(now, item.dueDate) <= 0;
    // Overdue work, or work due before the range even starts, gets the whole range to catch up.
    // Otherwise the item is schedulable up to whichever comes first: its due date or the range end.
    const endDate = isOverdueItem || dueDateOnly < startDate ? rangeEnd : dueDateOnly < rangeEnd ? dueDateOnly : rangeEnd;

    const orderedDates = dateRange(startDate, endDate);
    if (planningProfile.workStyle === "deadline_driven") orderedDates.reverse();

    const leftover = scheduleTask(item, remainingMinutes, {
      orderedDates,
      dayState,
      bounds,
      breakPreference: planningProfile.breakPreference,
      autoBreaks: planningProfile.autoBreaks,
      workStyle: planningProfile.workStyle,
      onChunks: (chunks) => {
        const isMultiSession = isSplittableWorkType(item) && chunks.length > 1;
        chunks.forEach((chunk, index) => {
          const start = combineDateAndMinutes(chunk.date, chunk.startMinute);
          const end = combineDateAndMinutes(chunk.date, chunk.startMinute + chunk.durationMinutes);
          newBlocks.push({
            id: chunkBlockId(userId, item.id, chunk.date, chunk.startMinute),
            userId,
            workItemId: item.id,
            workItemKind: item.kind,
            title: isMultiSession ? `${item.title} (part ${index + 1})` : item.title,
            start,
            end,
            origin: "generated",
            status: "planned",
            priorityScore: priorities[item.id].score,
            reason: explainPriority(item, priorities[item.id]),
          });
        });
      },
      onBreak: (entry) => breakEntries.push(entry),
    });

    if (leftover > MIN_CHUNK_MINUTES / 2) {
      unscheduledWorkItemIds.push(item.id);
    }
  }

  for (const entry of breakEntries) {
    const start = combineDateAndMinutes(entry.date, entry.startMinute);
    const end = combineDateAndMinutes(entry.date, entry.startMinute + entry.durationMinutes);
    newBlocks.push({
      id: breakBlockId(userId, entry.date, entry.startMinute),
      userId,
      title: "Break",
      start,
      end,
      origin: "break",
      status: "planned",
    });
  }

  const commitmentBlocks = materializeCommitmentBlocks(userId, dates, commitments);

  const warnings: ScheduleWarning[] = [
    ...detectOverload(schedulable, totalAvailableMinutes),
    ...hardDeadlineWarning(schedulable, unscheduledWorkItemIds),
  ];

  const caughtUp = !isBehind && unscheduledWorkItemIds.length === 0;
  const workAheadSuggestions = caughtUp ? buildWorkAheadSuggestions(outOfRangeSoon, now) : [];

  const blocks = [...preservedBlocks, ...commitmentBlocks, ...newBlocks].sort((a, b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : 0
  );

  return { blocks, unscheduledWorkItemIds, priorities, warnings, caughtUp, workAheadSuggestions, feedbackAdjustment };
}

interface ScheduleTaskContext {
  orderedDates: string[];
  dayState: Map<string, DayState>;
  bounds: { min: number; max: number };
  breakPreference: import("@/types/models").BreakPreference;
  autoBreaks: boolean;
  workStyle: import("@/types/models").WorkStyle;
  onChunks: (chunks: PlannedChunk[]) => void;
  onBreak: (entry: PlannedChunk) => void;
}

/** Places one work item's remaining minutes into the shared day ledger. Returns minutes left unplaced. */
export function scheduleTask(
  item: SchedulableWorkItem,
  remainingMinutes: number,
  context: ScheduleTaskContext
): number {
  const { orderedDates, dayState, bounds } = context;

  const slots: DaySlot[] = [];
  for (const date of orderedDates) {
    const state = dayState.get(date);
    if (!state) continue;
    for (const window of state.windows) {
      slots.push({ date, window, capacityRemaining: state.capacityRemaining });
    }
  }

  const roomyDays = orderedDates.filter((date) => {
    const state = dayState.get(date);
    return state && state.capacityRemaining >= MIN_CHUNK_MINUTES && state.windows.some((w) => w.endMinute - w.startMinute >= MIN_CHUNK_MINUTES);
  });

  let perSlotTargetMinutes: number | undefined;
  if (context.workStyle === "consistent" && roomyDays.length > 0) {
    perSlotTargetMinutes = Math.max(bounds.min, Math.ceil(remainingMinutes / roomyDays.length));
  } else if (
    (context.workStyle === "early" || context.workStyle === "adaptive") &&
    roomyDays.length > 1 &&
    remainingMinutes > bounds.max
  ) {
    // "Early" should still start today, but without a per-day cap a multi-day item with enough
    // capacity would get crammed entirely into day one — which starts early but doesn't actually
    // spread across the days available. Scale the even-split target up by EARLY_FRONT_LOAD_FACTOR
    // so it still leans toward finishing ahead of the deadline rather than spreading perfectly
    // evenly (that's what "consistent" is for), just not at the cost of one overloaded day.
    // Skipped for small items (remainingMinutes <= bounds.max) — nothing needs spreading if it
    // already fits in a single session.
    perSlotTargetMinutes = Math.max(bounds.min, Math.ceil((remainingMinutes / roomyDays.length) * EARLY_FRONT_LOAD_FACTOR));
  }

  const breakMinutes = context.autoBreaks ? BREAK_LENGTH_MINUTES[context.breakPreference] : 0;
  const { chunks, breaks, remainingMinutes: leftover } = splitTask(remainingMinutes, slots, bounds, {
    perSlotTargetMinutes,
    breakMinutes,
  });

  if (chunks.length > 0) context.onChunks(chunks);
  breaks.forEach(context.onBreak);
  applyChunksToDayState(dayState, chunks, breaks, context.autoBreaks, context.breakPreference, context.onBreak);

  return leftover;
}

/**
 * Consumes the day ledger by subtracting every chunk's interval from that day's free windows
 * (via the same `subtractIntervals` used for commitments — one correct implementation, not two),
 * then opportunistically reserves a short break right after each chunk when there's still
 * meaningful room left in the window it came from.
 */
function applyChunksToDayState(
  dayState: Map<string, DayState>,
  chunks: PlannedChunk[],
  internalBreaks: PlannedChunk[],
  autoBreaks: boolean,
  breakPreference: import("@/types/models").BreakPreference,
  onTrailingBreak: (entry: PlannedChunk) => void
): void {
  const breakLength = BREAK_LENGTH_MINUTES[breakPreference];

  const byDate = new Map<string, { chunks: PlannedChunk[]; breaks: PlannedChunk[] }>();
  for (const chunk of chunks) {
    if (!byDate.has(chunk.date)) byDate.set(chunk.date, { chunks: [], breaks: [] });
    byDate.get(chunk.date)!.chunks.push(chunk);
  }
  for (const brk of internalBreaks) {
    if (!byDate.has(brk.date)) byDate.set(brk.date, { chunks: [], breaks: [] });
    byDate.get(brk.date)!.breaks.push(brk);
  }

  for (const [date, dateEntries] of byDate) {
    const state = dayState.get(date);
    if (!state) continue;

    state.capacityRemaining -= dateEntries.chunks.reduce((sum, c) => sum + c.durationMinutes, 0);

    // Both chunks and the breaks already reserved between them occupy real wall-clock time —
    // both must be subtracted from the window, even though only chunk time counts against
    // the daily capacity target above.
    const busy: TimeWindow[] = [...dateEntries.chunks, ...dateEntries.breaks].map((c) => ({
      startMinute: c.startMinute,
      endMinute: c.startMinute + c.durationMinutes,
    }));

    let remaining: TimeWindow[] = [];
    for (const window of state.windows) {
      remaining.push(...subtractIntervals(window, busy));
    }

    if (autoBreaks) {
      const chunkEnds = new Set(dateEntries.chunks.map((c) => c.startMinute + c.durationMinutes));
      remaining = remaining.map((w) => {
        const followsAChunk = chunkEnds.has(w.startMinute);
        const hasRoomToSpare = w.endMinute - w.startMinute > breakLength + MIN_CHUNK_MINUTES;
        if (followsAChunk && hasRoomToSpare) {
          onTrailingBreak({ date, startMinute: w.startMinute, durationMinutes: breakLength });
          return { startMinute: w.startMinute + breakLength, endMinute: w.endMinute };
        }
        return w;
      });
    }

    state.windows = remaining.sort((a, b) => a.startMinute - b.startMinute);
  }
}

/**
 * Aggregate check: is there more estimated work than available time across the whole range?
 * This runs *before* placement outcomes are known, so it flags real capacity shortfalls even in
 * cases where greedy placement happens to still succeed for everything (Part 12).
 */
export function detectOverload(
  entries: { item: SchedulableWorkItem; remainingMinutes: number }[],
  totalAvailableMinutes: number
): ScheduleWarning[] {
  const totalDemandMinutes = entries.reduce((sum, e) => sum + e.remainingMinutes, 0);
  if (totalDemandMinutes <= totalAvailableMinutes || entries.length === 0) return [];

  const movable = entries.filter(
    (e) => e.item.deadlineStrictness === "flexible" || e.item.deadlineStrictness === "target"
  );
  const demandHours = Math.round((totalDemandMinutes / 60) * 10) / 10;
  const availableHours = Math.round((totalAvailableMinutes / 60) * 10) / 10;

  const movableNote =
    movable.length > 0
      ? ` Consider moving flexible work such as: ${movable.map((m) => m.item.title).join(", ")}.`
      : "";

  return [
    {
      kind: "overloaded-range",
      message: `This range has about ${demandHours}h of estimated work but only about ${availableHours}h of available time.${movableNote}`,
      workItemIds: entries.map((e) => e.item.id),
    },
  ];
}

function hardDeadlineWarning(
  entries: { item: SchedulableWorkItem }[],
  unscheduledWorkItemIds: string[]
): ScheduleWarning[] {
  const unscheduledSet = new Set(unscheduledWorkItemIds);
  const hardUnscheduled = entries
    .map((e) => e.item)
    .filter((item) => unscheduledSet.has(item.id) && (item.deadlineStrictness === "hard" || item.deadlineStrictness === "important"));

  if (hardUnscheduled.length === 0) return [];
  return [
    {
      kind: "unscheduled-hard-deadline",
      message: `${hardUnscheduled.length} item(s) with a hard or important deadline could not be fully scheduled in this range: ${hardUnscheduled.map((i) => i.title).join(", ")}.`,
      workItemIds: hardUnscheduled.map((i) => i.id),
    },
  ];
}

function buildWorkAheadSuggestions(candidates: SchedulableWorkItem[], now: string): WorkAheadSuggestion[] {
  const meaningful = candidates.filter((c) => c.kind === "test" || c.kind === "project" || c.workType === "essay");
  const scored = meaningful
    .map((item) => ({ item, breakdown: calculatePriority(item, { now, remainingMinutes: item.estimatedMinutes }) }))
    .sort((a, b) => b.breakdown.score - a.breakdown.score)
    .slice(0, 2);

  return scored.map(({ item }) => {
    const days = Math.max(1, Math.round(diffInDays(now, item.dueDate)));
    return {
      workItemId: item.id,
      title: item.title,
      reason: `You're caught up — "${item.title}" is due in ${days} days and could use a head start if you'd like to work ahead.`,
    };
  });
}

function materializeCommitmentBlocks(
  userId: string,
  dates: string[],
  commitments: import("@/types/models").Commitment[]
): ScheduleBlock[] {
  const blocks: ScheduleBlock[] = [];
  for (const date of dates) {
    const dow = new Date(`${date}T00:00:00`).getDay();
    for (const c of commitments) {
      const applies = c.recurrence.type === "weekly" ? c.recurrence.daysOfWeek.includes(dow) : c.recurrence.date === date;
      if (!applies) continue;
      const startTime = c.startTime.includes("T") ? c.startTime.split("T")[1] : c.startTime;
      const endTime = c.endTime.includes("T") ? c.endTime.split("T")[1] : c.endTime;
      blocks.push({
        id: `commitment_${c.id}_${date}`,
        userId,
        title: c.title,
        start: `${date}T${startTime}`,
        end: `${date}T${endTime}`,
        origin: "commitment",
        status: "planned",
      });
    }
  }
  return blocks;
}

/**
 * Recomputes the schedule after something changes, keeping completed/skipped/manually-moved
 * blocks fixed and regenerating everything else. Returns the full result (not just blocks) —
 * an intentional expansion of the Phase 1A stub signature, since the UI needs the same
 * warnings/priority context here as it does from a fresh `generateSchedule` call.
 */
export function replan(input: ReplanInput): GenerateScheduleResult {
  return generateSchedule(input);
}

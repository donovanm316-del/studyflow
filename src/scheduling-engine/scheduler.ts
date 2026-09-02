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
 *
 * Adaptive planning rules (Phase 5D, Part 16) — the invariants that make a re-run of this same
 * function behave like a real adjustment to reality rather than a fresh guess each time:
 *
 *  1. Never schedule in the past — today's placement window starts at `now`, not at the day's
 *     configured earliest availability (`clipWindowsToNow`, applied only to today).
 *  2. Completed work stays completed — filtered out via `notCompleted` before anything else runs.
 *  3. Active/in-progress work is never re-offered elsewhere — the caller excludes it from what it
 *     asks this function to place.
 *  4. Manual overrides are respected when possible — held fixed via `preservedBlocks`, never moved
 *     or resized by a regeneration; still counted against the item's remaining work either way.
 *  5. Current availability outranks historical availability — every call plans from `now` forward
 *     over the day's *current* windows, never a snapshot taken earlier.
 *  6. Exact deadlines are authoritative — `deadlineCap` clips a session to end before the deadline
 *     instant, not just somewhere on the deadline's calendar day.
 *  7. Hard/important deadlines are protected under pressure — `hardDeadlineWarning` reports rather
 *     than silently drops them, and urgent items are placed first (`URGENT_PROTECTION_HORIZON_DAYS`).
 *  8. Flexible/target work yields first when capacity is tight — it sorts behind protected work in
 *     the placement order and is what `detectOverload` suggests moving.
 *  9. Free-time preference shapes whether newly available time gets filled — never automatically in
 *     this module; see the decision-support layer, which only ever suggests, never auto-schedules.
 * 10. Being caught up protects free time — `caughtUp` and `freeMinutesRemainingToday` exist so
 *     callers can tell "nothing to do" from "nothing scheduled yet".
 * 11. Early completion creates real available time — recorded actual-vs-planned minutes reduce an
 *     item's remaining work (`remainingOf`), which is what frees room on the next regeneration.
 * 12. Late starts reduce available planning time — a later `now` means a smaller clipped window,
 *     which is the entire mechanism; there is no separate "catch-up" code path.
 * 13. Lost time is never recovered by exceeding workload preference — `dailyCapacityMinutes` comes
 *     from the Planning Profile and is not widened just because less of the day remains.
 * 14. No invented work — every block traces back to a real work item's real remaining minutes;
 *     nothing here pads a light day with busywork.
 * 15. Every automatic change is explainable — `explainScheduleDecision`/`explainPriority` produce
 *     the "why" for anything placed, from data this same result already computed.
 */
import {
  BREAK_LENGTH_MINUTES,
  EARLY_FRONT_LOAD_FACTOR,
  MIN_CHUNK_MINUTES,
  URGENT_PROTECTION_HORIZON_DAYS,
  WORK_AHEAD_HORIZON_DAYS,
} from "./constants";
import { calculateDailyCapacity, calculateFeedbackAdjustment } from "./capacity";
import { clipWindowsToNow, findAvailableWindows, subtractIntervals, type TimeWindow } from "./availability";
import { calculatePriority, explainPriority } from "./priority";
import { explainScheduleDecision } from "./explanation";
import { nextEligibleStage } from "./decomposition";
import { buildEstimateHistory, personalizeEstimate, type EstimateAdjustment } from "./estimation";
import { isSplittableWorkType, sessionBounds, splitTask, type DaySlot, type PlannedChunk } from "./splitting";
import {
  blockDurationMinutes,
  combineDateAndMinutes,
  dateRange,
  DEFAULT_DEADLINE_TIME,
  diffInDays,
  formatMinutesAsHoursMinutes,
  minutesOfDay,
  normalizeDeadline,
  toDateOnly,
} from "./date-utils";
import {
  calculateAvailableMinutesBeforeDeadline,
  calculateDeadlineCapacity,
  type DeadlineCapacity,
} from "./deadline-capacity";
import { calculateWorkloadStatus } from "./workload-status";
import type {
  DailyForecastEntry,
  GenerateScheduleInput,
  GenerateScheduleResult,
  PriorityBreakdown,
  ReplanInput,
  ScheduleDecisionExplanation,
  ScheduleWarning,
  SchedulableWorkItem,
  WorkAheadSuggestion,
} from "./types";
import type { CourseRigor, ScheduleBlock, WorkStage } from "@/types/models";

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
  // Phase 5D, Part 1/3/7: hoisted so both day-state construction (below) and the free-time figure
  // (further down) agree on the same "current moment", rather than each computing it separately.
  const nowMinuteOfDay = minutesOfDay(now.split("T")[1] ?? "00:00");
  const notCompleted = input.workItems.filter((item) => item.status !== "completed");

  // Phase 4: a work item with decomposed stages is never itself schedulable — only its single
  // next-eligible stage is (see `nextEligibleStage`). `unitFor` swaps a decomposed item for a
  // stand-in `SchedulableWorkItem` carrying the active stage's id/title/minutes but everything
  // else (weight, deadline, workType, rigor, kind) inherited from the parent, so the rest of this
  // function — priority, capacity, splitting, placement — needs no separate code path for stages.
  // Returns `null` for a decomposed item with no eligible stage left (e.g. all completed but the
  // parent item's own status hasn't caught up yet), meaning it contributes nothing to placement.
  const stagesByItem = new Map<string, WorkStage[]>();
  for (const stage of input.stages ?? []) {
    if (!stagesByItem.has(stage.workItemId)) stagesByItem.set(stage.workItemId, []);
    stagesByItem.get(stage.workItemId)!.push(stage);
  }
  function unitFor(item: SchedulableWorkItem): SchedulableWorkItem | null {
    const stages = stagesByItem.get(item.id);
    if (!stages || stages.length === 0) return item;
    const active = nextEligibleStage(stages);
    if (!active) return null;
    return {
      ...item,
      id: active.id,
      title: `${item.title} — ${active.title}`,
      estimatedMinutes: active.estimatedMinutes,
      actualMinutes: active.actualMinutes ?? 0,
    };
  }

  // Phase 4.5C: the student's estimate is the *input* to planning, not the planning figure itself.
  // Personalizing here — once, at the single point where schedulable units are resolved — is what
  // makes the adjusted estimate flow identically into placement, priority, capacity, deadline
  // buffer and the forecast. Doing it per-consumer would let those numbers disagree.
  const estimateHistory = buildEstimateHistory(input.workSessions ?? [], input.workItems, input.stages ?? []);
  const estimateAdjustments: Record<string, EstimateAdjustment> = {};
  const stageParentId = new Map((input.stages ?? []).map((s) => [s.id, s.workItemId]));

  function planWith(unit: SchedulableWorkItem): SchedulableWorkItem {
    const adjustment = personalizeEstimate(unit, estimateHistory);
    estimateAdjustments[unit.id] = adjustment;
    // Mirror onto the parent id for decomposed work, matching how `priorities` and
    // `deadlineCapacities` are keyed, so UI keyed by the work item resolves too.
    const parentId = stageParentId.get(unit.id);
    if (parentId) estimateAdjustments[parentId] = { ...adjustment, workItemId: parentId };
    return adjustment.adjusted ? { ...unit, estimatedMinutes: adjustment.planningMinutes } : unit;
  }

  const inRange = notCompleted
    .filter((item) => toDateOnly(item.dueDate) <= rangeEnd || diffInDays(now, item.dueDate) <= 0)
    .map(unitFor)
    .filter((unit): unit is SchedulableWorkItem => unit !== null)
    .map(planWith);
  const outOfRangeSoon = notCompleted.filter(
    (item) =>
      toDateOnly(item.dueDate) > rangeEnd &&
      diffInDays(now, item.dueDate) > 0 &&
      diffInDays(now, item.dueDate) <= WORK_AHEAD_HORIZON_DAYS
  );

  // Minutes already committed to a manual-override block that hasn't been completed yet must not
  // be counted as "still needing to be scheduled" — otherwise moving a session (Part 14) doesn't
  // reduce what the engine thinks is left, and the same work gets placed a second time elsewhere.
  const manualMinutesByItem = new Map<string, number>();
  for (const block of preservedBlocks) {
    if (block.origin === "manual-override" && block.status === "planned" && block.workItemId) {
      const duration = blockDurationMinutes(block.start, block.end);
      manualMinutesByItem.set(block.workItemId, (manualMinutesByItem.get(block.workItemId) ?? 0) + duration);
    }
  }
  const remainingOf = (item: SchedulableWorkItem) =>
    Math.max(0, item.estimatedMinutes - (item.actualMinutes ?? 0) - (manualMinutesByItem.get(item.id) ?? 0));

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
    const rawWindows = findAvailableWindows(date, planningProfile, commitments, existingBlocks);
    // Today's windows never include time already past — this is what keeps a fresh generation (or
    // an explicit replan) from ever placing new work before the current moment (Part 1/3/7). Other
    // days are untouched: there is no "now" to clip against on a day that hasn't started yet.
    const windows = date === today ? clipWindowsToNow(rawWindows, nowMinuteOfDay) : rawWindows;
    dayState.set(date, { windows, capacityRemaining: dailyCapacityMinutes });
  }

  // Priorities are computed for every not-yet-completed item (in and out of range) so callers
  // like the Dashboard can show an explainable ranking even for work this call doesn't place.
  // For a decomposed item, the score reflects its *active stage* (what's actually next) — stored
  // under both the parent item's id (so existing lookups like Dashboard's `priorities[item.id]`
  // keep working unchanged) and the stage's own id (so placement/explanation lookups, which key
  // off whatever id ended up on the block, also resolve).
  const priorities: Record<string, PriorityBreakdown> = {};
  for (const item of notCompleted) {
    const resolved = unitFor(item);
    if (!resolved) {
      priorities[item.id] = calculatePriority(item, { now, remainingMinutes: 0 });
      continue;
    }
    // Same personalized figure the placement pass uses — priority's workload factor must not be
    // scored against a different estimate than the one actually being scheduled.
    const unit = planWith(resolved);
    const breakdown = calculatePriority(unit, { now, remainingMinutes: remainingOf(unit) });
    priorities[item.id] = { ...breakdown, workItemId: item.id };
    if (unit.id !== item.id) priorities[unit.id] = breakdown;
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

  const availableMinutesByDate = new Map<string, number>();
  for (const date of dates) {
    const state = dayState.get(date)!;
    const windowMinutes = state.windows.reduce((s, w) => s + (w.endMinute - w.startMinute), 0);
    availableMinutesByDate.set(date, Math.min(windowMinutes, dailyCapacityMinutes));
  }
  const totalAvailableMinutes = [...availableMinutesByDate.values()].reduce((sum, m) => sum + m, 0);

  const newBlocks: ScheduleBlock[] = [];
  const breakEntries: PlannedChunk[] = [];
  const unscheduledWorkItemIds: string[] = [];
  const bounds = sessionBounds(planningProfile.breakPreference);
  const startDate = rangeStart > today ? rangeStart : today;

  for (const { item, remainingMinutes } of schedulable) {
    const deadlineIso = normalizeDeadline(item.dueDate);
    const dueDateOnly = toDateOnly(deadlineIso);
    const isOverdueItem = diffInDays(now, deadlineIso) <= 0;
    // Overdue work, or work due before the range even starts, gets the whole range to catch up.
    // Otherwise the item is schedulable up to whichever comes first: its due date or the range end.
    const endDate = isOverdueItem || dueDateOnly < startDate ? rangeEnd : dueDateOnly < rangeEnd ? dueDateOnly : rangeEnd;

    // A student-set "don't start before this date" hint (Part 10) narrows the window further,
    // but never past today — it's a soft preference about when to *begin*, not a way to push
    // overdue or already-behind work later than it already is.
    const effectiveStart =
      item.preferredStartDate && item.preferredStartDate > startDate && item.preferredStartDate <= endDate
        ? item.preferredStartDate
        : startDate;

    let orderedDates = dateRange(effectiveStart, endDate);
    // A test/quiz is prep work for something that happens ON the due date. When no exam *time* was
    // given, the deadline defaults to end-of-day (23:59) — that's an absence of information, not a
    // claim the exam is at midnight, so the Phase 3A behavior stands and the whole exam day is
    // excluded rather than optimistically assuming a full day of cramming is available before it.
    //
    // When the student did specify a time (Phase 4.5A, Part 10), that's real information: prep
    // before a 3:00 PM exam that morning is legitimate, and prep before an 8:00 AM one barely
    // exists. `deadlineCap` below enforces the actual cutoff precisely, so excluding the whole day
    // as well would just discard usable time the student really has.
    const examTimeUnspecified = deadlineIso.endsWith(`T${DEFAULT_DEADLINE_TIME}`);
    if ((item.kind === "test" || item.kind === "quiz") && examTimeUnspecified && orderedDates.length > 1) {
      orderedDates = orderedDates.filter((d) => d !== dueDateOnly);
    }
    if (planningProfile.workStyle === "deadline_driven") orderedDates.reverse();

    // Work must finish *before the deadline instant*, not merely somewhere on the deadline's
    // calendar day (Phase 4.5A, Part 5/10). For a test at 9:00 AM this leaves only the morning
    // window that day; for one at 3:00 PM it leaves considerably more. An overdue item has no
    // future cap to apply — it's already past, and gets the whole range to catch up.
    const deadlineCap = isOverdueItem ? undefined : { date: dueDateOnly, minute: minutesOfDay(deadlineIso.split("T")[1]) };

    const leftover = scheduleTask(item, remainingMinutes, {
      orderedDates,
      deadlineCap,
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

  const hardDeadlineWarnings = hardDeadlineWarning(schedulable, unscheduledWorkItemIds);

  const caughtUp = !isBehind && unscheduledWorkItemIds.length === 0;
  const workAheadSuggestions = caughtUp ? buildWorkAheadSuggestions(outOfRangeSoon, now) : [];
  const workloadStatus = calculateWorkloadStatus(schedulable, totalAvailableMinutes, hardDeadlineWarnings.length > 0);

  const workMinutesByDate = new Map<string, number>();
  for (const block of newBlocks) {
    if (!block.workItemId) continue; // breaks don't count as workload
    const date = toDateOnly(block.start);
    const duration = blockDurationMinutes(block.start, block.end);
    workMinutesByDate.set(date, (workMinutesByDate.get(date) ?? 0) + duration);
  }
  const dailyForecast: DailyForecastEntry[] = dates.map((date) => ({
    date,
    workMinutes: workMinutesByDate.get(date) ?? 0,
    availableMinutes: availableMinutesByDate.get(date) ?? 0,
  }));

  const blocks = [...preservedBlocks, ...commitmentBlocks, ...newBlocks].sort((a, b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : 0
  );

  const newSessionCountByItem = new Map<string, number>();
  for (const block of newBlocks) {
    if (!block.workItemId) continue;
    newSessionCountByItem.set(block.workItemId, (newSessionCountByItem.get(block.workItemId) ?? 0) + 1);
  }
  // How much usable time genuinely remains before each item's exact deadline (Phase 4.5A, Part
  // 7/8), and whether the work still fits.
  //
  // Two deliberate choices make this answer the question a student actually asks — "will I make
  // this deadline?" — rather than a bookkeeping question:
  //
  //  1. Work remaining is `estimated - actual`: what's still to be *done*. Scheduling or pinning a
  //     session doesn't reduce it, because the student hasn't done it yet. (The placement pass
  //     above uses a different figure, `remainingOf`, which nets off pinned minutes precisely so it
  //     doesn't schedule the same work twice — that's the right measure there and the wrong one here.)
  //  2. Available time excludes commitments and *other* items' blocks, but not this item's own —
  //     time already reserved for this very work is time available to it. Counting it as busy would
  //     make every scheduled item look starved.
  //
  // Together these mean moving a session *within* the window leaves the buffer unchanged, while
  // moving it past the deadline genuinely reduces it — which is what makes the "what if I move
  // this?" preview trustworthy.
  const deadlineCapacities: Record<string, DeadlineCapacity> = {};
  for (const item of inRange) {
    const workLeft = Math.max(0, item.estimatedMinutes - (item.actualMinutes ?? 0));
    const otherItemsBlocks = existingBlocks.filter((b) => b.workItemId !== item.id);
    const capacity = calculateDeadlineCapacity(
      item.id,
      item.dueDate,
      workLeft,
      now,
      planningProfile,
      commitments,
      otherItemsBlocks,
      { dailyCapacityMinutes, preferredStartDate: item.preferredStartDate }
    );
    deadlineCapacities[item.id] = capacity;
    // Mirror onto the parent item's id for a decomposed item, so UI keyed by the work item (not
    // the active stage) resolves too — same convention `priorities` uses.
    const parentId = stagesByItem.size > 0 ? (input.stages ?? []).find((s) => s.id === item.id)?.workItemId : undefined;
    if (parentId) deadlineCapacities[parentId] = { ...capacity, workItemId: parentId };
  }

  // An item whose remaining work no longer fits in the usable time left before its deadline is
  // reported outright, rather than being quietly left to look fine because its calendar date is
  // still in the future. Limited to hard/important deadlines so overdue flexible work can't bury
  // the schedule in warnings — the existing strictness hierarchy still governs (Part 9).
  const atRiskItems = schedulable.filter(
    ({ item }) =>
      (item.deadlineStrictness === "hard" || item.deadlineStrictness === "important") &&
      deadlineCapacities[item.id]?.risk === "at-risk"
  );
  const deadlineRiskWarnings: ScheduleWarning[] = atRiskItems.length
    ? [
        {
          kind: "deadline-at-risk",
          message: `${atRiskItems.length === 1 ? "One item has" : `${atRiskItems.length} items have`} less usable time left than the work still needs: ${atRiskItems
            .map(({ item }) => {
              const cap = deadlineCapacities[item.id];
              return `${item.title} (about ${formatMinutesAsHoursMinutes(cap.availableMinutes)} available, ${formatMinutesAsHoursMinutes(cap.estimatedMinutes)} of work left)`;
            })
            .join("; ")}.`,
          workItemIds: atRiskItems.map(({ item }) => item.id),
        },
      ]
    : [];

  // Real free time left today: usable availability from now to end of day (commitments and fixed
  // blocks already removed by `calculateAvailableMinutesBeforeDeadline`), minus the work this pass
  // still has ahead of the current moment.
  const workAheadTodayMinutes = newBlocks
    .filter((b) => b.workItemId && toDateOnly(b.start) === today && minutesOfDay(b.end.split("T")[1]) > nowMinuteOfDay)
    .reduce((sum, b) => sum + blockDurationMinutes(b.start, b.end), 0);
  const freeMinutesRemainingToday = Math.max(
    0,
    calculateAvailableMinutesBeforeDeadline(`${today}T23:59`, now, planningProfile, commitments, existingBlocks) -
      workAheadTodayMinutes
  );

  const warnings: ScheduleWarning[] = [
    ...detectOverload(schedulable, totalAvailableMinutes),
    ...hardDeadlineWarnings,
    ...deadlineRiskWarnings,
  ];

  const decisionExplanations: Record<string, ScheduleDecisionExplanation> = {};
  for (const { item, remainingMinutes } of schedulable) {
    const sessionCount = newSessionCountByItem.get(item.id);
    if (!sessionCount) continue; // nothing actually placed for this item in this call
    decisionExplanations[item.id] = explainScheduleDecision(item, priorities[item.id], {
      remainingMinutes,
      sessionCount,
      isBehind,
      now,
      deadlineCapacity: deadlineCapacities[item.id],
    });
  }

  return {
    blocks,
    unscheduledWorkItemIds,
    priorities,
    warnings,
    caughtUp,
    workAheadSuggestions,
    feedbackAdjustment,
    workloadStatus,
    dailyForecast,
    decisionExplanations,
    deadlineCapacities,
    estimateAdjustments,
    freeMinutesRemainingToday,
  };
}

interface ScheduleTaskContext {
  orderedDates: string[];
  /** Clips this item's usable time on its deadline date so no session runs past the deadline itself. */
  deadlineCap?: { date: string; minute: number };
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

  // Truncates a window at the deadline instant on the deadline's own date; returns null for a
  // window that lies entirely after it (or is left too short to hold a real session).
  const clipToDeadline = (date: string, window: TimeWindow): TimeWindow | null => {
    if (!context.deadlineCap || date !== context.deadlineCap.date) return window;
    const endMinute = Math.min(window.endMinute, context.deadlineCap.minute);
    if (endMinute - window.startMinute < MIN_CHUNK_MINUTES) return null;
    return { startMinute: window.startMinute, endMinute };
  };

  const slots: DaySlot[] = [];
  for (const date of orderedDates) {
    const state = dayState.get(date);
    if (!state) continue;
    for (const window of state.windows) {
      const usable = clipToDeadline(date, window);
      if (!usable) continue;
      slots.push({ date, window: usable, capacityRemaining: state.capacityRemaining });
    }
  }

  const roomyDays = orderedDates.filter((date) => {
    const state = dayState.get(date);
    return (
      state &&
      state.capacityRemaining >= MIN_CHUNK_MINUTES &&
      state.windows.some((w) => {
        const usable = clipToDeadline(date, w);
        return usable && usable.endMinute - usable.startMinute >= MIN_CHUNK_MINUTES;
      })
    );
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
  // Tests/quizzes are suggested as "review" (Part 7: "Review an upcoming test or quiz"); anything
  // else meaningful (projects, essays, other long-term work) is suggested as "work ahead".
  const meaningful = candidates.filter(
    (c) => c.kind === "test" || c.kind === "quiz" || c.kind === "project" || c.workType === "essay" || c.workType === "long-term"
  );
  const scored = meaningful
    .map((item) => ({ item, breakdown: calculatePriority(item, { now, remainingMinutes: item.estimatedMinutes }) }))
    .sort((a, b) => b.breakdown.score - a.breakdown.score)
    .slice(0, 2);

  return scored.map(({ item }) => {
    const days = Math.max(1, Math.round(diffInDays(now, item.dueDate)));
    const type: WorkAheadSuggestion["type"] = item.kind === "test" || item.kind === "quiz" ? "review" : "work-ahead";
    const reason =
      type === "review"
        ? `You're caught up — "${item.title}" is in ${days} days and a little review now could take pressure off later.`
        : `You're caught up — "${item.title}" is due in ${days} days and could use a head start if you'd like to work ahead.`;
    return { workItemId: item.id, title: item.title, reason, type };
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
 * Recomputes the *entire remaining* schedule after something changes — a skipped session, a new
 * item, a changed due date (Phase 3A, Part 1) — rather than just relocating whatever triggered
 * the change. This is not a separate algorithm: `generateSchedule` already rebuilds every
 * non-fixed block from scratch on every call (only completed/skipped/manually-overridden blocks
 * are held fixed, via `preservedBlocks` above), so marking one block skipped and calling this
 * again naturally reflows everything else around the new capacity/availability picture — a big
 * item can shift into room freed up by the skip, not just get pushed to tomorrow. `reason` is
 * primarily documentation for the caller about *why* a replan was triggered (the UI already
 * knows and explains this to the student); it isn't consumed by the algorithm itself.
 */
export function replanRemainingSchedule(input: ReplanInput): GenerateScheduleResult {
  return generateSchedule(input);
}

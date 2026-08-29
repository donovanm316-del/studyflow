/**
 * Decision support (Phase 4.5B): the questions a calendar can't answer — "what should I work on
 * right now?", "why that?", "how much buffer do I have?", "what if I don't?", "what fits in the
 * 30 minutes I actually have?", "is my week manageable?".
 *
 * ARCHITECTURAL RULE: none of this is a second scheduler. Every function here either reads a
 * `GenerateScheduleResult` the engine already produced, or re-runs that same `generateSchedule`
 * over a hypothetical (never-persisted) copy of the inputs. There is exactly one place that
 * decides what gets scheduled when, and it is `scheduling-engine/scheduler.ts`.
 */
import {
  diffSchedules,
  formatMinutesAsHoursMinutes,
  generateSchedule,
  minutesUntil,
  normalizeDeadline,
  toDateOnly,
  type DeadlineCapacity,
  type GenerateScheduleInput,
  type GenerateScheduleResult,
  type SchedulableWorkItem,
  type ScheduleChangeSummary,
} from "@/scheduling-engine";
import { fixedBlocksAfterMove, fixedBlocksAfterReplanToday } from "@/lib/schedule-mutations";
import type { ScheduleBlock, WorkStage } from "@/types/models";

/** Minimum minutes of work below which a "best time to start" recommendation isn't worth showing. */
export const START_RECOMMENDATION_MIN_MINUTES = 120;

/* ------------------------------------------------------------------ *
 * Buffer, in language a student can act on (Part 3 / Part 4)
 * ------------------------------------------------------------------ */

export interface BufferSummary {
  capacity: DeadlineCapacity;
  /** Short status word shown alongside an icon — never color alone (Part 17). */
  label: "Comfortable" | "Tight" | "At risk" | "Overdue";
  icon: string;
  /** One calm, practical sentence. */
  sentence: string;
}

const RISK_LABEL: Record<DeadlineCapacity["risk"], BufferSummary["label"]> = {
  comfortable: "Comfortable",
  tight: "Tight",
  "at-risk": "At risk",
  overdue: "Overdue",
};

const RISK_ICON: Record<DeadlineCapacity["risk"], string> = {
  comfortable: "✓",
  tight: "!",
  "at-risk": "▲",
  overdue: "•",
};

/**
 * Turns the engine's numbers into a sentence. Deliberately calm: an at-risk deadline states the
 * shortfall plainly rather than alarming the student, because the useful response to "you're an
 * hour short" is to re-plan, not to panic.
 */
export function summarizeBuffer(capacity: DeadlineCapacity): BufferSummary {
  const { risk, bufferMinutes, estimatedMinutes } = capacity;

  let sentence: string;
  if (risk === "overdue") {
    sentence = "This deadline has already passed.";
  } else if (estimatedMinutes <= 0) {
    sentence = "There's no work left on this.";
  } else if (risk === "at-risk") {
    sentence = `You're about ${formatMinutesAsHoursMinutes(Math.abs(bufferMinutes))} short of the time needed before this deadline.`;
  } else if (risk === "tight") {
    sentence =
      bufferMinutes <= 0
        ? "You have just enough available time to finish this."
        : `You have about ${formatMinutesAsHoursMinutes(bufferMinutes)} of buffer before this deadline — not much spare.`;
  } else {
    sentence = `You have about ${formatMinutesAsHoursMinutes(bufferMinutes)} of buffer before this deadline.`;
  }

  return { capacity, label: RISK_LABEL[risk], icon: RISK_ICON[risk], sentence };
}

/* ------------------------------------------------------------------ *
 * "Why now?" (Part 2)
 * ------------------------------------------------------------------ */

/**
 * Immediate, present-tense reasons for working on this *now*, as opposed to the broader
 * "why was this scheduled at all" bullets the engine already produces. Every branch is gated on
 * real data — a reason with nothing behind it is simply omitted rather than softened into a
 * generic filler line.
 */
export function buildWhyNow(
  block: ScheduleBlock,
  result: GenerateScheduleResult,
  now: string
): string[] {
  const reasons: string[] = [];
  if (!block.workItemId) return reasons;

  const capacity = result.deadlineCapacities[block.workItemId];
  const priority = result.priorities[block.workItemId];

  if (capacity) {
    const hoursLeft = capacity.minutesUntilDeadline / 60;
    if (capacity.risk === "overdue") {
      reasons.push("This is already past its deadline.");
    } else if (capacity.imminent) {
      reasons.push(`The deadline is within the next day — about ${formatMinutesAsHoursMinutes(capacity.minutesUntilDeadline)} away.`);
    } else if (hoursLeft > 0 && hoursLeft <= 72) {
      reasons.push(`The deadline is coming up in about ${Math.round(hoursLeft / 24)} day${Math.round(hoursLeft / 24) === 1 ? "" : "s"}.`);
    }

    if (capacity.estimatedMinutes > 0) {
      reasons.push(`About ${formatMinutesAsHoursMinutes(capacity.estimatedMinutes)} of work still remains.`);
    }

    if (capacity.risk === "at-risk") {
      reasons.push(
        `There's less usable time left than this needs — about ${formatMinutesAsHoursMinutes(Math.abs(capacity.bufferMinutes))} short.`
      );
    } else if (capacity.risk === "tight") {
      reasons.push("There isn't much spare time before the deadline, so this session matters.");
    } else if (capacity.bufferMinutes > 0) {
      reasons.push("Doing this now protects your buffer before the deadline.");
    }
  }

  if (priority?.factors.weight === 1) {
    reasons.push("This is one of your higher-importance items.");
  }

  // Multi-session work genuinely can't be left to the last day, which is a real reason to start.
  const sessionCount = result.blocks.filter(
    (b) => b.workItemId === block.workItemId && b.status === "planned"
  ).length;
  if (sessionCount > 1) {
    reasons.push(`This is planned across ${sessionCount} sessions, so it can't all be done at the end.`);
  }

  // Only claim something about "later today" when there is a real later block to compare against.
  const today = toDateOnly(now);
  const laterToday = result.blocks.filter(
    (b) => b.workItemId && b.status === "planned" && toDateOnly(b.start) === today && b.start > block.start
  );
  if (laterToday.length > 0) {
    reasons.push(`${laterToday.length} more session${laterToday.length === 1 ? "" : "s"} follow${laterToday.length === 1 ? "s" : ""} this one today.`);
  }

  return reasons;
}

/* ------------------------------------------------------------------ *
 * "What if I don't do this now?" (Part 5 / Part 6)
 * ------------------------------------------------------------------ */

export type MoveVerdict = "on-track" | "tighter" | "shortfall";

export interface MovePreview {
  /** What the student is choosing between — mirrors the two real actions on the Today page. */
  action: "move-to-tomorrow" | "replan-today";
  minutesFreedToday: number;
  bufferBeforeMinutes: number | null;
  bufferAfterMinutes: number | null;
  riskBefore: DeadlineCapacity["risk"] | null;
  riskAfter: DeadlineCapacity["risk"] | null;
  verdict: MoveVerdict;
  headline: string;
  detail: string;
  /** The real schedule diff this change would produce, from the existing `diffSchedules`. */
  changes: ScheduleChangeSummary;
}

function blockMinutes(block: ScheduleBlock): number {
  const [sh, sm] = block.start.split("T")[1].split(":").map(Number);
  const [eh, em] = block.end.split("T")[1].split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

/** Minutes of this item's planned work that the engine actually placed at or before its deadline. */
function scheduledMinutesBeforeDeadline(
  result: GenerateScheduleResult,
  workItemId: string,
  deadline: string
): number {
  return result.blocks
    .filter((b) => b.workItemId === workItemId && b.status === "planned" && b.end <= deadline)
    .reduce((sum, b) => sum + blockMinutes(b), 0);
}

function shiftToNextDay(iso: string): string {
  const [date, time] = iso.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y, m - 1, d + 1);
  const nextDate = `${next.getFullYear()}-${(next.getMonth() + 1).toString().padStart(2, "0")}-${next.getDate().toString().padStart(2, "0")}`;
  return `${nextDate}T${time}`;
}

/**
 * Runs the real engine over a hypothetical copy of the inputs to show what a change *would* do,
 * without touching anything persisted (Part 6). The block-list transformation is the same shared
 * helper the store uses when the student actually confirms, so this preview cannot drift away
 * from what really happens.
 */
export function previewMove(
  baseInput: GenerateScheduleInput,
  currentResult: GenerateScheduleResult,
  block: ScheduleBlock,
  action: MovePreview["action"]
): MovePreview {
  const existing = baseInput.existingBlocks ?? [];
  const hypotheticalBlocks =
    action === "move-to-tomorrow"
      ? fixedBlocksAfterMove(existing, block, shiftToNextDay(block.start), shiftToNextDay(block.end), "preview_moved")
      : fixedBlocksAfterReplanToday(existing, block, "preview_skipped");

  // A throwaway run: nothing here is written back to the store.
  const previewResult = generateSchedule({ ...baseInput, existingBlocks: hypotheticalBlocks });

  const itemId = block.workItemId;
  const before = itemId ? currentResult.deadlineCapacities[itemId] : undefined;
  const after = itemId ? previewResult.deadlineCapacities[itemId] : undefined;

  const riskBefore = before?.risk ?? null;
  const riskAfter = after?.risk ?? null;
  const bufferBefore = before?.bufferMinutes ?? null;
  const bufferAfter = after?.bufferMinutes ?? null;

  // Capacity alone can't see a session pushed *past* its own deadline: the time before the
  // deadline is unchanged, so the buffer looks fine while the work would in fact land too late.
  // Comparing work needed against what the engine actually placed before the deadline catches it.
  const unplacedBeforeDeadline =
    itemId && after
      ? Math.max(0, after.estimatedMinutes - scheduledMinutesBeforeDeadline(previewResult, itemId, after.deadline))
      : 0;

  // The verdict is read from the engine's own risk classification plus its actual placement —
  // never a separately invented judgement.
  let verdict: MoveVerdict = "on-track";
  if (riskAfter === "at-risk" || riskAfter === "overdue" || unplacedBeforeDeadline > 0) verdict = "shortfall";
  else if (riskAfter === "tight" && riskBefore !== "tight") verdict = "tighter";
  else if (bufferBefore != null && bufferAfter != null && bufferAfter < bufferBefore && riskAfter === "tight") verdict = "tighter";

  const headline =
    verdict === "shortfall"
      ? "This would leave less time than the work needs"
      : verdict === "tighter"
        ? "This makes things tighter"
        : "Still on track";

  let detail: string;
  if (unplacedBeforeDeadline > 0) {
    detail = `About ${formatMinutesAsHoursMinutes(unplacedBeforeDeadline)} of this wouldn't fit before the deadline any more.`;
  } else if (verdict === "shortfall" && after) {
    detail = `Moving this would leave about ${formatMinutesAsHoursMinutes(after.availableMinutes)} of usable time before the deadline, against ${formatMinutesAsHoursMinutes(after.estimatedMinutes)} of work.`;
  } else if (bufferAfter != null) {
    detail = `You'd have about ${formatMinutesAsHoursMinutes(Math.max(0, bufferAfter))} of buffer left before the deadline.`;
  } else {
    detail = "Your remaining schedule would be recalculated around this change.";
  }

  return {
    action,
    minutesFreedToday: blockMinutes(block),
    bufferBeforeMinutes: bufferBefore,
    bufferAfterMinutes: bufferAfter,
    riskBefore,
    riskAfter,
    verdict,
    headline,
    detail,
    changes: diffSchedules(currentResult.blocks, previewResult.blocks),
  };
}

/* ------------------------------------------------------------------ *
 * "I have 30 minutes" (Part 7)
 * ------------------------------------------------------------------ */

export interface TimeSuggestion {
  block: ScheduleBlock;
  /** Minutes to actually spend — the whole session, or a partial one for splittable work. */
  minutes: number;
  partial: boolean;
  reason: string;
}

/**
 * The best use of a window of free time the student says they have right now.
 *
 * This does not re-plan anything: it picks from the sessions the engine has *already* placed, so
 * every constraint the student cares about — deadlines, commitments, preferred start dates, manual
 * overrides, capacity, their Planning Profile — was enforced when those blocks were created. A
 * session longer than the window is only offered as a partial sitting when the underlying item is
 * genuinely splittable.
 */
export function bestUseOfTime(
  availableMinutes: number,
  result: GenerateScheduleResult,
  workItems: SchedulableWorkItem[],
  stages: WorkStage[],
  now: string
): TimeSuggestion | null {
  if (availableMinutes <= 0) return null;
  const today = toDateOnly(now);

  const candidates = result.blocks
    .filter(
      (b) =>
        !!b.workItemId &&
        b.status === "planned" &&
        (b.origin === "generated" || b.origin === "manual-override") &&
        toDateOnly(b.start) >= today
    )
    .map((block) => {
      const minutes = blockMinutes(block);
      const item = resolveItem(block.workItemId!, workItems, stages);
      const splittable = item ? isSplittable(item) : false;
      return { block, minutes, item, splittable };
    })
    // Never recommend something that can't fit — unless it's work that legitimately splits.
    .filter((c) => c.minutes <= availableMinutes || c.splittable)
    .sort((a, b) => {
      // Prefer sessions that fit whole; then by the engine's own priority score.
      const aFits = a.minutes <= availableMinutes;
      const bFits = b.minutes <= availableMinutes;
      if (aFits !== bFits) return aFits ? -1 : 1;
      const aScore = result.priorities[a.block.workItemId!]?.score ?? 0;
      const bScore = result.priorities[b.block.workItemId!]?.score ?? 0;
      if (aScore !== bScore) return bScore - aScore;
      return a.block.start < b.block.start ? -1 : 1;
    });

  const best = candidates[0];
  if (!best) return null;

  const fits = best.minutes <= availableMinutes;
  const minutes = fits ? best.minutes : availableMinutes;
  const capacity = result.deadlineCapacities[best.block.workItemId!];

  let reason: string;
  if (!fits) {
    reason = `This is longer than ${formatMinutesAsHoursMinutes(availableMinutes)}, but it splits across sessions — you can make a start now.`;
  } else if (capacity?.risk === "at-risk" || capacity?.risk === "tight") {
    reason = "There isn't much spare time before this deadline, so this is the most useful thing to do now.";
  } else if (toDateOnly(best.block.start) === today) {
    reason = "This is already planned for today — doing it now gets it out of the way.";
  } else {
    reason = "Doing this now removes a session from a later day.";
  }

  return { block: best.block, minutes, partial: !fits, reason };
}

/** Resolves a block's `workItemId`, which for decomposed work is a stage id, back to its item. */
function resolveItem(
  blockWorkItemId: string,
  workItems: SchedulableWorkItem[],
  stages: WorkStage[]
): SchedulableWorkItem | undefined {
  const direct = workItems.find((i) => i.id === blockWorkItemId);
  if (direct) return direct;
  const stage = stages.find((s) => s.id === blockWorkItemId);
  return stage ? workItems.find((i) => i.id === stage.workItemId) : undefined;
}

const SPLITTABLE_WORK_TYPES = new Set(["project", "essay", "long-term", "test-prep"]);
function isSplittable(item: SchedulableWorkItem): boolean {
  return item.splittable ?? SPLITTABLE_WORK_TYPES.has(item.workType);
}

/* ------------------------------------------------------------------ *
 * "Best time to start" (Part 8)
 * ------------------------------------------------------------------ */

export interface StartRecommendation {
  workItemId: string;
  title: string;
  /** The date the engine actually chose to begin this work — not a separately invented date. */
  startDate: string;
  sessionCount: number;
  totalMinutes: number;
  reason: string;
}

/**
 * For genuinely large work, reports when the engine already plans to start and why spreading it
 * matters. This deliberately *reads* the schedule rather than computing an independent "ideal"
 * start date — a second opinion that disagreed with the actual plan would be worse than useless.
 * Returns null for small or single-session work, where the advice would be noise.
 */
export function recommendStartDate(
  item: SchedulableWorkItem,
  result: GenerateScheduleResult,
  stages: WorkStage[]
): StartRecommendation | null {
  const itemStageIds = new Set(stages.filter((s) => s.workItemId === item.id).map((s) => s.id));
  const blocks = result.blocks
    .filter(
      (b) =>
        b.status === "planned" &&
        b.origin !== "break" &&
        b.origin !== "commitment" &&
        !!b.workItemId &&
        (b.workItemId === item.id || itemStageIds.has(b.workItemId))
    )
    .sort((a, b) => (a.start < b.start ? -1 : 1));

  if (blocks.length < 2) return null;
  const totalMinutes = blocks.reduce((sum, b) => sum + blockMinutes(b), 0);
  if (totalMinutes < START_RECOMMENDATION_MIN_MINUTES) return null;

  const distinctDays = new Set(blocks.map((b) => toDateOnly(b.start))).size;
  const startDate = toDateOnly(blocks[0].start);

  const reason =
    distinctDays > 1
      ? `Starting ${weekdayName(startDate)} lets StudyFlow spread about ${formatMinutesAsHoursMinutes(totalMinutes)} across ${distinctDays} days instead of stacking it into one.`
      : `Starting ${weekdayName(startDate)} leaves room for the remaining sessions before the deadline.`;

  return {
    workItemId: item.id,
    title: item.title,
    startDate,
    sessionCount: blocks.length,
    totalMinutes,
    reason,
  };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function weekdayName(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return DAY_NAMES[new Date(y, m - 1, d).getDay()];
}

/* ------------------------------------------------------------------ *
 * Weekly plan health + week explanation (Part 9 / Part 10)
 * ------------------------------------------------------------------ */

export interface DayHealth {
  date: string;
  workMinutes: number;
  availableMinutes: number;
  bufferMinutes: number;
  status: "light" | "comfortable" | "getting-tight" | "over-capacity";
}

export function buildDayHealth(result: GenerateScheduleResult): DayHealth[] {
  return result.dailyForecast.map((day) => {
    const bufferMinutes = day.availableMinutes - day.workMinutes;
    let status: DayHealth["status"];
    if (day.workMinutes === 0) status = "light";
    else if (bufferMinutes < 0) status = "over-capacity";
    else if (bufferMinutes < day.workMinutes * 0.25) status = "getting-tight";
    else status = "comfortable";
    return { ...day, bufferMinutes, status };
  });
}

export interface WeekSummary {
  headline: string;
  detail: string;
  level: "ahead" | "on-track" | "getting-tight" | "at-risk";
}

/**
 * A plain-language read on the whole week, built from the engine's own `workloadStatus` plus the
 * real per-day forecast — the tight day named here is genuinely the tightest day the engine
 * planned, not an illustrative example.
 */
export function summarizeWeek(result: GenerateScheduleResult): WeekSummary {
  const status = result.workloadStatus;
  const days = buildDayHealth(result);
  const pressured = days.filter((d) => d.status === "over-capacity" || d.status === "getting-tight");
  const tightest = pressured.sort((a, b) => a.bufferMinutes - b.bufferMinutes)[0];

  const headline =
    status.level === "at-risk"
      ? "You're currently at risk."
      : status.level === "getting-tight"
        ? "Your week is getting tight."
        : status.level === "ahead"
          ? "You're ahead."
          : "Your week is on track.";

  const parts: string[] = [];
  if (status.level === "at-risk") {
    const blocked = result.warnings.find((w) => w.kind === "unscheduled-hard-deadline" || w.kind === "deadline-at-risk");
    parts.push(
      blocked
        ? "Some hard-deadline work doesn't fit in your remaining available time."
        : `You have about ${formatMinutesAsHoursMinutes(status.estimatedRemainingMinutes)} of work against about ${formatMinutesAsHoursMinutes(status.availableMinutes)} of usable time.`
    );
  } else if (status.estimatedRemainingMinutes === 0) {
    parts.push("There's no estimated work left to place in this range.");
  } else {
    parts.push(
      `You have enough usable time to finish your current workload, with about ${formatMinutesAsHoursMinutes(Math.max(0, status.bufferMinutes))} of buffer.`
    );
  }

  if (tightest) {
    parts.push(
      tightest.status === "over-capacity"
        ? `${weekdayName(tightest.date)} is planned beyond its available time.`
        : `${weekdayName(tightest.date)} has the least room left.`
    );
  }

  return { headline, detail: parts.join(" "), level: status.level };
}

/* ------------------------------------------------------------------ *
 * Free time still protected today (Part 11)
 * ------------------------------------------------------------------ */

/** Usable minutes today that no work or commitment is currently claiming, from the real forecast. */
export function freeMinutesToday(result: GenerateScheduleResult, now: string): number {
  const today = toDateOnly(now);
  const entry = result.dailyForecast.find((d) => d.date === today);
  if (!entry) return 0;
  return Math.max(0, entry.availableMinutes - entry.workMinutes);
}

/** Hours until a deadline, used for wording — re-exported so UI needn't import engine internals. */
export function minutesUntilDeadline(dueDate: string, now: string): number {
  return minutesUntil(now, normalizeDeadline(dueDate));
}

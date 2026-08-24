/**
 * Turns "N minutes of remaining work" + "a sequence of available day slots" into concrete
 * work-session chunks (Part 5 / Part 8). Pure and order-driven: the caller (`scheduler.ts`)
 * decides what order to offer slots in (chronological, reverse, or evenly-spaced) based on the
 * student's `workStyle` — this module just fills whatever order it's given, respecting session
 * bounds and never creating a chunk smaller than `MIN_CHUNK_MINUTES`.
 */
import { DEFAULT_SPLITTABLE_WORK_TYPES, MIN_CHUNK_MINUTES, SESSION_LENGTH_BOUNDS } from "./constants";
import type { TimeWindow } from "./availability";
import type { BreakPreference } from "@/types/models";
import type { SchedulableWorkItem } from "./types";

export interface DaySlot {
  date: string;
  window: TimeWindow;
  /** Remaining soft daily-capacity minutes for this day, already reduced by anything placed earlier. */
  capacityRemaining: number;
}

export interface PlannedChunk {
  date: string;
  startMinute: number;
  durationMinutes: number;
}

export function sessionBounds(breakPreference: BreakPreference): { min: number; max: number } {
  return SESSION_LENGTH_BOUNDS[breakPreference];
}

export function isSplittableWorkType(item: SchedulableWorkItem): boolean {
  return item.splittable ?? DEFAULT_SPLITTABLE_WORK_TYPES.has(item.workType);
}

export interface SplitTaskOptions {
  /** Caps how much of a single slot one task may use, so "consistent" work style spreads evenly. */
  perSlotTargetMinutes?: number;
  /**
   * Minutes to reserve between two sessions this call packs back-to-back in the same window.
   * Without this, a task split into two 60-minute chunks that both land in one long window would
   * run as one uninterrupted 120-minute block — defeating the point of splitting by session length.
   */
  breakMinutes?: number;
}

export function splitTask(
  remainingMinutes: number,
  slots: DaySlot[],
  bounds: { min: number; max: number },
  options: SplitTaskOptions = {}
): { chunks: PlannedChunk[]; breaks: PlannedChunk[]; remainingMinutes: number } {
  let remaining = remainingMinutes;
  const chunks: PlannedChunk[] = [];
  const breaks: PlannedChunk[] = [];
  const breakMinutes = options.breakMinutes ?? 0;

  for (const slot of slots) {
    if (remaining <= 0) break;

    const slotFree = Math.min(slot.window.endMinute - slot.window.startMinute, slot.capacityRemaining);
    if (slotFree < MIN_CHUNK_MINUTES) continue;

    let cursor = slot.window.startMinute;
    let slotBudget = options.perSlotTargetMinutes ? Math.min(slotFree, options.perSlotTargetMinutes) : slotFree;

    while (remaining > 0 && slotBudget >= MIN_CHUNK_MINUTES) {
      const duration = Math.min(bounds.max, remaining, slotBudget);
      if (duration < MIN_CHUNK_MINUTES) break;

      chunks.push({ date: slot.date, startMinute: cursor, durationMinutes: duration });
      cursor += duration;
      slotBudget -= duration;
      remaining -= duration;

      // Reserve a break before the next session in this same window, but only if something
      // more will actually be placed there — otherwise it just shrinks the leftover free time
      // for no reason.
      if (remaining > 0 && breakMinutes > 0 && slotBudget >= breakMinutes + MIN_CHUNK_MINUTES) {
        breaks.push({ date: slot.date, startMinute: cursor, durationMinutes: breakMinutes });
        cursor += breakMinutes;
        slotBudget -= breakMinutes;
      }
    }
  }

  return { chunks, breaks, remainingMinutes: remaining };
}

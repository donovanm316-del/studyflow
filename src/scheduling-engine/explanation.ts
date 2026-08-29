/**
 * Turns the same data `generateSchedule` already computed (priority breakdown, remaining
 * minutes, how many sessions got placed, real time-to-deadline) into a short, structured "why was
 * this scheduled" explanation a student can expand on demand (Phase 3B, Part 4/5; extended with
 * deadline-time reasoning in Phase 4.5A, Part 11). Nothing here recomputes or re-derives a
 * different answer than the engine actually used — it just narrates it.
 */
import { explainPriority } from "./priority";
import { addDays, formatClockTime, formatMinutesAsHoursMinutes, normalizeDeadline, toDateOnly, weekdayName } from "./date-utils";
import type { DeadlineCapacity } from "./deadline-capacity";
import type { PriorityBreakdown, SchedulableWorkItem, ScheduleDecisionExplanation } from "./types";

export interface ExplanationContext {
  remainingMinutes: number;
  sessionCount: number;
  isBehind: boolean;
  /** Current moment, so deadline wording ("tonight", "tomorrow") is anchored to real time. */
  now?: string;
  /** Real available-vs-needed figures, when the caller computed them (Phase 4.5A). */
  deadlineCapacity?: DeadlineCapacity;
}

/** "tonight at 11:59 PM" / "tomorrow at 3:00 PM" / "Friday at 8:00 AM" — only ever from real data. */
function describeDeadline(deadlineIso: string, now: string): string {
  const time = formatClockTime(deadlineIso);
  const deadlineDate = toDateOnly(deadlineIso);
  const today = toDateOnly(now);

  if (deadlineDate === today) {
    const hour = Number(deadlineIso.split("T")[1].split(":")[0]);
    return `${hour >= 17 ? "tonight" : "today"} at ${time}`;
  }
  if (deadlineDate === addDays(today, 1)) return `tomorrow at ${time}`;
  return `${weekdayName(deadlineDate)} at ${time}`;
}

export function explainScheduleDecision(
  item: SchedulableWorkItem,
  breakdown: PriorityBreakdown,
  context: ExplanationContext
): ScheduleDecisionExplanation {
  const bullets: string[] = [];

  // Deadline first — with a real timestamp it's the single most useful thing to lead with.
  if (context.now) {
    bullets.push(`Due ${describeDeadline(normalizeDeadline(item.dueDate), context.now)}`);
  }

  const weightPhrase = item.weight === "high" ? "High importance" : item.weight === "medium" ? "Medium importance" : "Low importance";
  bullets.push(weightPhrase);

  const strictnessPhrase =
    item.deadlineStrictness === "hard"
      ? "Hard deadline"
      : item.deadlineStrictness === "important"
        ? "Important deadline"
        : item.deadlineStrictness === "flexible"
          ? "Flexible deadline"
          : "Self-set target date";
  bullets.push(strictnessPhrase);

  if (context.remainingMinutes > 0) {
    bullets.push(`${formatMinutesAsHoursMinutes(context.remainingMinutes)} of work remaining`);
  }

  if (context.sessionCount > 0) {
    bullets.push(`${context.sessionCount} session${context.sessionCount === 1 ? "" : "s"} planned before the deadline`);
  }

  // The honest available-vs-needed comparison, stated only when it was actually measured.
  const capacity = context.deadlineCapacity;
  if (capacity && context.remainingMinutes > 0) {
    if (capacity.risk === "at-risk") {
      bullets.push(
        `Only about ${formatMinutesAsHoursMinutes(capacity.availableMinutes)} of usable time is left before the deadline — less than this needs`
      );
    } else if (capacity.risk === "tight") {
      bullets.push(
        `About ${formatMinutesAsHoursMinutes(capacity.availableMinutes)} of usable time is left before the deadline — not much spare`
      );
    } else if (capacity.bufferMinutes > 0) {
      bullets.push(
        `About ${formatMinutesAsHoursMinutes(capacity.availableMinutes)} of usable time before the deadline, leaving ${formatMinutesAsHoursMinutes(capacity.bufferMinutes)} of buffer`
      );
    }
  }

  bullets.push(
    context.isBehind
      ? "Scheduled now because you're behind and this needs to catch up"
      : capacity?.imminent
        ? "Scheduled now because the deadline is within the next day"
        : "Scheduled at a time that fits your available hours and workload preferences"
  );

  return {
    workItemId: item.id,
    primaryReason: explainPriority(item, breakdown),
    bullets,
  };
}

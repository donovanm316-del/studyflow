/**
 * Turns the same data `generateSchedule` already computed (priority breakdown, remaining
 * minutes, how many sessions got placed) into a short, structured "why was this scheduled"
 * explanation a student can expand on demand (Phase 3B, Part 4/5). Nothing here recomputes or
 * re-derives a different answer than the engine actually used — it just narrates it.
 */
import { explainPriority } from "./priority";
import { formatMinutesAsHoursMinutes } from "./date-utils";
import type { PriorityBreakdown, SchedulableWorkItem, ScheduleDecisionExplanation } from "./types";

export function explainScheduleDecision(
  item: SchedulableWorkItem,
  breakdown: PriorityBreakdown,
  context: { remainingMinutes: number; sessionCount: number; isBehind: boolean }
): ScheduleDecisionExplanation {
  const bullets: string[] = [];

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

  bullets.push(
    context.isBehind
      ? "Scheduled now because you're behind and this needs to catch up"
      : "Scheduled at a time that fits your available hours and workload preferences"
  );

  return {
    workItemId: item.id,
    primaryReason: explainPriority(item, breakdown),
    bullets,
  };
}

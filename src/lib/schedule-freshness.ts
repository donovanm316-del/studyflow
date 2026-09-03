/**
 * "Can this schedule still be trusted as today's plan?" (Phase 5D, Part 2/15).
 *
 * Deliberately not a second scheduler and not a timer that re-plans on every tick (Part 18) — this
 * only *compares* the schedule the engine already produced against the current wall clock, and
 * reports a small, deterministic set of reasons when they've meaningfully diverged. The one real
 * trigger this module exists to catch is a student leaving the tab open while time passes with no
 * other state change — every other kind of mismatch listed in Part 2 (a session completed, moved,
 * a commitment edited, an item's estimate changed) already forces a fresh `generateSchedule` call
 * on its own, because those are real store-state changes `useScheduleInput` already depends on.
 *
 * VALID / STALE, not a third "replanned" value here — "replanned" isn't a property of the schedule
 * itself, it's simply what a fresh `generateSchedule` result already *is* once the student acts on
 * a stale banner (see `Today`'s `refreshKey`). Tracking it separately would be state with nothing
 * new to say.
 */
import type { DeadlineCapacity, GenerateScheduleResult } from "@/scheduling-engine";
import type { ScheduleBlock } from "@/types/models";

export type ScheduleFreshness = "valid" | "stale";

export interface StalenessResult {
  freshness: ScheduleFreshness;
  /** Short, deterministic, plain-language reasons — never more than needed to explain the banner. */
  reasons: string[];
}

const ACTIONABLE_ORIGINS = new Set<ScheduleBlock["origin"]>(["generated", "manual-override"]);

/**
 * A block counts as "passed" when it was real, plannable work (not a break or commitment), is
 * still marked `planned` (the student never completed, skipped, or moved it), and its own end time
 * has already gone by. That is the one honest, unambiguous signal that today's plan no longer
 * matches reality without the student having done anything about it yet.
 */
function isPassed(block: ScheduleBlock, nowIso: string): boolean {
  return ACTIONABLE_ORIGINS.has(block.origin) && block.status === "planned" && block.end <= nowIso;
}

export function detectStaleness(todaysBlocks: ScheduleBlock[], nowIso: string): StalenessResult {
  const passed = todaysBlocks.filter((b) => isPassed(b, nowIso));
  if (passed.length === 0) return { freshness: "valid", reasons: [] };

  const reasons =
    passed.length === 1
      ? [`You started later than planned — "${passed[0].title}" was planned earlier and hasn't been logged.`]
      : [`${passed.length} planned sessions have already passed without being logged.`];

  return { freshness: "stale", reasons };
}

/**
 * "What's happening with today's plan right now?" (Phase 6B, Part 1).
 *
 * Deliberately a *synthesis* of state the engine and `detectStaleness` already computed, not a
 * parallel judgment — every branch reads a real existing field:
 *
 *  - `stale` from `detectStaleness` above (a planned session already passed unlogged).
 *  - `caught-up` from the engine's own `caughtUp` flag.
 *  - `at-risk` / `behind` from the engine's `DeadlineCapacity.risk` on whatever's next, and its
 *    week-level `workloadStatus.level` — the same numbers `summarizeBuffer`/`WorkloadStatusBadge`
 *    already show elsewhere, not a new threshold invented for this one purpose.
 *  - `ahead` mirrors `workloadStatus.level` directly.
 *  - `on-track` is the default: nothing above applies.
 *
 * Six states, not the full list a first draft might reach for (Part 1 explicitly warns against
 * that) — "starting late" isn't its own state here because the response to it is identical to any
 * other staleness (show the banner, offer "Adjust my schedule"); the *reason text* already
 * distinguishes one missed session from several, which is the only place the distinction matters.
 */
export type ScheduleState = "stale" | "caught-up" | "at-risk" | "behind" | "ahead" | "on-track";

export function deriveScheduleState(
  staleness: StalenessResult,
  result: Pick<GenerateScheduleResult, "caughtUp" | "workloadStatus">,
  nextActionRisk: DeadlineCapacity["risk"] | null
): ScheduleState {
  if (staleness.freshness === "stale") return "stale";
  if (result.caughtUp) return "caught-up";
  if (nextActionRisk === "at-risk") return "at-risk";
  if (nextActionRisk === "tight" || result.workloadStatus.level === "getting-tight") return "behind";
  if (result.workloadStatus.level === "ahead") return "ahead";
  return "on-track";
}

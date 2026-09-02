"use client";

import { useMemo } from "react";
import { generateSchedule, type GenerateScheduleInput, type GenerateScheduleResult } from "@/scheduling-engine";
import { useAppData } from "./store";
import { nowLocalIso } from "@/lib/now";

/**
 * The exact input `useSchedule` feeds the engine. Exposed separately so decision-support previews
 * ("what if I move this?") can re-run `generateSchedule` over a hypothetical copy of the *same*
 * inputs — the preview and the live schedule are then guaranteed to be the same computation, not
 * two implementations that could drift (Phase 4.5B, Part 6).
 *
 * `refreshKey` (Phase 5D, Part 7/18): bumping it forces a fresh `nowLocalIso()` read even when
 * nothing else in the store changed — the mechanism behind "Adjust my schedule". Wall-clock time
 * passing on its own does *not* retrigger this memo (there is no ticking dependency here on
 * purpose), so opening the app and leaving it idle never silently reshuffles the plan; only a real
 * state change or an explicit refresh does. See `useLiveNow`/`schedule-freshness.ts` for the
 * separate, non-recomputing mechanism that *detects* when an idle tab has gone stale.
 */
export function useScheduleInput(rangeStart: string, rangeEnd: string, refreshKey: number = 0): GenerateScheduleInput {
  const { workItems, commitments, planningProfile, fixedBlocks, feedback, stages, workSessions } = useAppData();

  return useMemo(
    () => ({
      userId: planningProfile.userId,
      rangeStart,
      rangeEnd,
      now: nowLocalIso(),
      workItems,
      commitments,
      planningProfile,
      existingBlocks: fixedBlocks,
      feedback,
      stages,
      workSessions,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey is a deliberate bare trigger (its value is never read), the mechanism behind "Adjust my schedule"
    [workItems, commitments, planningProfile, fixedBlocks, feedback, stages, workSessions, rangeStart, rangeEnd, refreshKey]
  );
}

/** Runs the scheduling engine over the current store state for the given date range. */
export function useSchedule(rangeStart: string, rangeEnd: string, refreshKey: number = 0): GenerateScheduleResult {
  const input = useScheduleInput(rangeStart, rangeEnd, refreshKey);
  return useMemo(() => generateSchedule(input), [input]);
}

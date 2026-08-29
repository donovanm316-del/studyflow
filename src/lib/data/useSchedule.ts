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
 */
export function useScheduleInput(rangeStart: string, rangeEnd: string): GenerateScheduleInput {
  const { workItems, commitments, planningProfile, fixedBlocks, feedback, stages } = useAppData();

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
    }),
    [workItems, commitments, planningProfile, fixedBlocks, feedback, stages, rangeStart, rangeEnd]
  );
}

/** Runs the scheduling engine over the current store state for the given date range. */
export function useSchedule(rangeStart: string, rangeEnd: string): GenerateScheduleResult {
  const input = useScheduleInput(rangeStart, rangeEnd);
  return useMemo(() => generateSchedule(input), [input]);
}

"use client";

import { useMemo } from "react";
import { generateSchedule, type GenerateScheduleResult } from "@/scheduling-engine";
import { useAppData } from "./store";
import { nowLocalIso } from "@/lib/now";

/** Runs the scheduling engine over the current store state for the given date range. */
export function useSchedule(rangeStart: string, rangeEnd: string): GenerateScheduleResult {
  const { workItems, commitments, planningProfile, fixedBlocks, feedback } = useAppData();

  return useMemo(
    () =>
      generateSchedule({
        userId: planningProfile.userId,
        rangeStart,
        rangeEnd,
        now: nowLocalIso(),
        workItems,
        commitments,
        planningProfile,
        existingBlocks: fixedBlocks,
        feedback,
      }),
    [workItems, commitments, planningProfile, fixedBlocks, feedback, rangeStart, rangeEnd]
  );
}

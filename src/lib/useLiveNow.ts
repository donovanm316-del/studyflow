"use client";

import { useEffect, useState } from "react";
import { nowLocalIso } from "@/lib/now";

/**
 * A wall-clock value that ticks on its own (Phase 5D, Part 2) — used only to *detect* that a
 * displayed schedule has gone stale while the tab sits open. Deliberately not fed into
 * `generateSchedule`: doing that would re-place work every tick and shift anything scheduled to
 * start "now" by a minute each time, which is exactly the over-replanning Part 18 rules out. The
 * schedule itself only ever recomputes on a real state change or an explicit "adjust" action.
 */
export function useLiveNow(intervalMs = 30_000): string {
  const [now, setNow] = useState(() => nowLocalIso());

  useEffect(() => {
    const id = setInterval(() => setNow(nowLocalIso()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}

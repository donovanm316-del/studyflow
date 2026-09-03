import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-text guard for the stability guarantee behind Phase 6B, Part 8 ("avoid constant
 * rescheduling"): the schedule must only recompute on a real store-state change or an explicit
 * `refreshKey` bump — never merely because wall-clock time passed while the tab sat open. This
 * project has no DOM testing library to mount the hook and assert re-render counts directly, so —
 * consistent with other behavior-guarding tests here — it checks the one thing that would break
 * this guarantee: a ticking value sneaking into `useScheduleInput`'s memo dependency array.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/lib/data/useSchedule.ts"), "utf8");

describe("schedule computation stability", () => {
  it("computes 'now' by reading the clock once per memo run, not from a ticking dependency", () => {
    expect(SOURCE).toContain("now: nowLocalIso()");
  });

  it("useLiveNow (the ticking clock) is not imported here — staleness detection lives elsewhere", () => {
    expect(SOURCE).not.toMatch(/import\s*\{[^}]*useLiveNow/);
  });

  it("refreshKey is the only mechanism that forces a recompute independent of real state changes", () => {
    expect(SOURCE).toMatch(/refreshKey: number = 0/);
    expect(SOURCE).toMatch(/\[workItems, commitments, planningProfile, fixedBlocks, feedback, stages, workSessions, rangeStart, rangeEnd, refreshKey\]/);
  });
});

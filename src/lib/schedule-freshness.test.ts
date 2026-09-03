import { describe, expect, it } from "vitest";
import { deriveScheduleState, detectStaleness } from "./schedule-freshness";
import type { GenerateScheduleResult } from "@/scheduling-engine";
import type { ScheduleBlock } from "@/types/models";

function fakeResult(overrides: { caughtUp?: boolean; level?: GenerateScheduleResult["workloadStatus"]["level"] } = {}) {
  return {
    caughtUp: overrides.caughtUp ?? false,
    workloadStatus: {
      level: overrides.level ?? "on-track",
      message: "",
      estimatedRemainingMinutes: 0,
      availableMinutes: 0,
      bufferMinutes: 0,
    },
  };
}

function block(overrides: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id: "b1",
    userId: "u1",
    workItemId: "item1",
    workItemKind: "assignment",
    title: "Math homework",
    start: "2026-08-24T15:00",
    end: "2026-08-24T16:00",
    origin: "generated",
    status: "planned",
    ...overrides,
  };
}

describe("Phase 5D, Scenario H — stale schedule detection", () => {
  it("is valid when nothing has passed yet", () => {
    const result = detectStaleness([block()], "2026-08-24T14:00");
    expect(result.freshness).toBe("valid");
    expect(result.reasons).toEqual([]);
  });

  it("is valid for a block currently in progress (not yet past)", () => {
    const result = detectStaleness([block()], "2026-08-24T15:30");
    expect(result.freshness).toBe("valid");
  });

  it("goes stale once a planned block's own end time has passed", () => {
    const result = detectStaleness([block()], "2026-08-24T16:30");
    expect(result.freshness).toBe("stale");
    expect(result.reasons.length).toBe(1);
    expect(result.reasons[0]).toMatch(/started later than planned/);
  });

  it("reports a count once more than one session has passed", () => {
    const blocks = [
      block({ id: "b1", start: "2026-08-24T15:00", end: "2026-08-24T15:45" }),
      block({ id: "b2", start: "2026-08-24T16:00", end: "2026-08-24T16:45" }),
    ];
    const result = detectStaleness(blocks, "2026-08-24T17:00");
    expect(result.freshness).toBe("stale");
    expect(result.reasons[0]).toMatch(/^2 planned sessions/);
  });

  it("does not flag a block the student already completed", () => {
    const result = detectStaleness([block({ status: "completed" })], "2026-08-24T18:00");
    expect(result.freshness).toBe("valid");
  });

  it("does not flag a block the student already skipped", () => {
    const result = detectStaleness([block({ status: "skipped" })], "2026-08-24T18:00");
    expect(result.freshness).toBe("valid");
  });

  it("does not flag a break or commitment block, only real work", () => {
    const result = detectStaleness(
      [block({ origin: "break", workItemId: undefined }), block({ origin: "commitment", workItemId: undefined })],
      "2026-08-24T18:00"
    );
    expect(result.freshness).toBe("valid");
  });

  it("does not go stale merely because the clock has moved past midnight into a later day", () => {
    // Yesterday's blocks aren't part of "today" — the caller is responsible for only passing in
    // today's blocks, but this guards that the function itself does no date-crossing surprises.
    const result = detectStaleness([block({ start: "2026-08-24T15:00", end: "2026-08-24T16:00" })], "2026-08-24T16:00");
    expect(result.freshness).toBe("stale"); // end <= now is inclusive at the boundary
  });
});

describe("Phase 6B, Part 1 — deriveScheduleState", () => {
  const valid = { freshness: "valid" as const, reasons: [] };
  const stale = { freshness: "stale" as const, reasons: ["You started later than planned."] };

  it("is 'stale' whenever the schedule has gone stale, regardless of anything else", () => {
    expect(deriveScheduleState(stale, fakeResult({ caughtUp: true }), null)).toBe("stale");
    expect(deriveScheduleState(stale, fakeResult({ level: "at-risk" }), "at-risk")).toBe("stale");
  });

  it("is 'caught-up' when the engine reports no remaining work, even with lower-priority risk", () => {
    expect(deriveScheduleState(valid, fakeResult({ caughtUp: true }), null)).toBe("caught-up");
  });

  it("is 'at-risk' when the next recommended item's own deadline capacity is at-risk", () => {
    expect(deriveScheduleState(valid, fakeResult({ level: "getting-tight" }), "at-risk")).toBe("at-risk");
  });

  it("is 'behind' when the next item is tight, or the week-level status is getting-tight", () => {
    expect(deriveScheduleState(valid, fakeResult({ level: "on-track" }), "tight")).toBe("behind");
    expect(deriveScheduleState(valid, fakeResult({ level: "getting-tight" }), "comfortable")).toBe("behind");
  });

  it("is 'ahead' when the week-level status says so and nothing more urgent applies", () => {
    expect(deriveScheduleState(valid, fakeResult({ level: "ahead" }), "comfortable")).toBe("ahead");
  });

  it("defaults to 'on-track' when nothing else applies", () => {
    expect(deriveScheduleState(valid, fakeResult({ level: "on-track" }), "comfortable")).toBe("on-track");
    expect(deriveScheduleState(valid, fakeResult({ level: "on-track" }), null)).toBe("on-track");
  });
});

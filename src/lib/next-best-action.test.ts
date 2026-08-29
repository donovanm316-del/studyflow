import { describe, expect, it } from "vitest";
import { getNextBestAction } from "./next-best-action";
import type { GenerateScheduleResult, ScheduleDecisionExplanation, WorkAheadSuggestion } from "@/scheduling-engine";
import type { ActiveWorkSession, ScheduleBlock } from "@/types/models";

const NOW = "2026-08-24T16:00"; // Monday, 4:00 PM

function block(overrides: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return {
    id: "b1",
    userId: "u1",
    workItemId: "item1",
    workItemKind: "assignment",
    title: "Biology — Practice",
    start: "2026-08-24T17:00",
    end: "2026-08-24T17:45",
    origin: "generated",
    status: "planned",
    ...overrides,
  };
}

function makeResult(overrides: Partial<GenerateScheduleResult> = {}): GenerateScheduleResult {
  return {
    blocks: [],
    unscheduledWorkItemIds: [],
    priorities: {},
    warnings: [],
    caughtUp: false,
    workAheadSuggestions: [],
    feedbackAdjustment: 1,
    workloadStatus: { level: "on-track", message: "", estimatedRemainingMinutes: 0, availableMinutes: 0, bufferMinutes: 0 },
    dailyForecast: [],
    decisionExplanations: {},
    deadlineCapacities: {},
    estimateAdjustments: {},
    ...overrides,
  };
}

describe("getNextBestAction", () => {
  it("returns the active session and nothing else when one is in progress (Part 17/18)", () => {
    const activeSession: ActiveWorkSession = { workItemId: "item1", workItemTitle: "Biology — Practice", startedAt: "2026-08-24T16:00", plannedMinutes: 45 };
    const result = makeResult({ blocks: [block()] });
    const action = getNextBestAction(result, activeSession, NOW);
    expect(action.kind).toBe("current-session");
    if (action.kind === "current-session") {
      expect(action.title).toBe("Biology — Practice");
    }
  });

  it("recommends the chronologically-next planned work block, sourced from real schedule data (Part 17)", () => {
    const b = block({ start: "2026-08-24T17:00", end: "2026-08-24T17:45" });
    const result = makeResult({ blocks: [b] });
    const action = getNextBestAction(result, null, NOW);
    expect(action.kind).toBe("scheduled");
    if (action.kind === "scheduled") {
      expect(action.block.id).toBe(b.id);
      expect(action.minutesLabel).toBe("45m");
    }
  });

  it("never recommends a block that's already completed (Part 19)", () => {
    const done = block({ id: "done1", status: "completed" });
    const upcoming = block({ id: "b2", start: "2026-08-24T18:00", end: "2026-08-24T18:30" });
    const result = makeResult({ blocks: [done, upcoming] });
    const action = getNextBestAction(result, null, NOW);
    expect(action.kind).toBe("scheduled");
    if (action.kind === "scheduled") expect(action.block.id).toBe("b2");
  });

  it("never recommends a stage whose dependency isn't done — it only reads what the engine actually placed (Part 20)", () => {
    // The engine never places a dependent stage's block until it's eligible (see scheduler.test.ts
    // Phase 4 tests) — so from the NBA's point of view, an ineligible stage simply has no block to
    // recommend. Only the eligible one (already on the schedule) can ever be picked.
    const eligibleStageBlock = block({ id: "stage_research", workItemId: "p1_stage_0", title: "Project — Research" });
    const result = makeResult({ blocks: [eligibleStageBlock] });
    const action = getNextBestAction(result, null, NOW);
    expect(action.kind).toBe("scheduled");
    if (action.kind === "scheduled") expect(action.block.workItemId).toBe("p1_stage_0");
  });

  it("surfaces the real decision explanation for the recommended block, not a fabricated one (Part 20/21)", () => {
    const b = block();
    const explanation: ScheduleDecisionExplanation = { workItemId: "item1", primaryReason: "Biology — Practice received priority 0.80", bullets: ["High importance", "Hard deadline"] };
    const result = makeResult({ blocks: [b], decisionExplanations: { item1: explanation } });
    const action = getNextBestAction(result, null, NOW);
    expect(action.kind).toBe("scheduled");
    if (action.kind === "scheduled") {
      expect(action.primaryReason).toBe(explanation.primaryReason);
      expect(action.reasonBullets).toEqual(explanation.bullets);
    }
  });

  it("includes what comes after the next action when something else is scheduled (Part 16)", () => {
    const first = block({ id: "b1", start: "2026-08-24T17:00", end: "2026-08-24T17:45" });
    const second = block({ id: "b2", title: "Math homework", start: "2026-08-24T18:00", end: "2026-08-24T18:30" });
    const result = makeResult({ blocks: [first, second] });
    const action = getNextBestAction(result, null, NOW);
    expect(action.kind).toBe("scheduled");
    if (action.kind === "scheduled") {
      expect(action.after).toEqual({ title: "Math homework", minutesLabel: "30m" });
    }
  });

  it("reports a clear no-work state when nothing is left today and the student isn't caught up (Part 19/23)", () => {
    const result = makeResult({ blocks: [], caughtUp: false });
    const action = getNextBestAction(result, null, NOW);
    expect(action.kind).toBe("no-work");
    if (action.kind === "no-work") {
      expect(action.message).toBe("Nothing else is scheduled today.");
      expect(action.optional).toEqual([]);
    }
  });

  it("never invents work for a caught-up student — only offers real, engine-sourced suggestions (Part 24)", () => {
    const suggestion: WorkAheadSuggestion = { workItemId: "p1", title: "History Project", reason: "You're caught up — \"History Project\" is due in 5 days.", type: "work-ahead" };
    const result = makeResult({ blocks: [], caughtUp: true, workAheadSuggestions: [suggestion] });
    const action = getNextBestAction(result, null, NOW);
    expect(action.kind).toBe("no-work");
    if (action.kind === "no-work") {
      expect(action.message).toBe("You're caught up.");
      expect(action.optional).toEqual([suggestion]);
    }
  });

  it("does not recommend a block that already finished earlier today", () => {
    const past = block({ id: "past1", start: "2026-08-24T09:00", end: "2026-08-24T09:30" });
    const result = makeResult({ blocks: [past] });
    const action = getNextBestAction(result, null, NOW); // now is 16:00
    expect(action.kind).toBe("no-work");
  });
});

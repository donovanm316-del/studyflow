import { describe, expect, it } from "vitest";
import { DEFAULT_PLANNING_PROFILE, migrateSavedState } from "./migrate";

/** A representative pre-Phase-4 save: date-only deadlines, no stages, no personalization fields. */
const LEGACY_SAVE = {
  workItems: [
    {
      kind: "assignment",
      id: "a1",
      userId: "demo-user",
      title: "Legacy Essay",
      dueDate: "2026-08-30",
      status: "not-started",
      estimatedMinutes: 60,
      weight: "medium",
      deadlineStrictness: "hard",
      workType: "homework",
      createdAt: "2026-08-01T08:00",
      updatedAt: "2026-08-01T08:00",
    },
  ],
  commitments: [{ id: "c1", userId: "demo-user", title: "Practice", category: "sports", recurrence: { type: "weekly", daysOfWeek: [1] }, startTime: "16:00", endTime: "18:00" }],
  planningProfile: {
    userId: "demo-user",
    dailyAvailability: [{ dayOfWeek: 1, earliest: "15:00", latest: "21:00" }],
    preferredSessionMinutes: 45,
    bufferDays: 1,
    autoBreaks: true,
    workloadTolerance: "moderate",
    breakPreference: "balanced",
    freeTimePriority: "medium",
    workStyle: "early",
  },
  fixedBlocks: [],
  workSessions: [{ id: "s1", userId: "demo-user", workItemId: "a1", start: "2026-08-02T16:00", plannedMinutes: 40, minutesSpent: 50 }],
  feedback: [],
};

describe("migrateSavedState — backward compatibility", () => {
  it("preserves every part of a legacy save", () => {
    const state = migrateSavedState(LEGACY_SAVE, true);

    expect(state.workItems).toHaveLength(1);
    expect(state.commitments).toHaveLength(1);
    expect(state.workSessions).toHaveLength(1);
    expect(state.planningProfile.dailyAvailability).toHaveLength(1);
    expect(state.planningProfile.workStyle).toBe("early");
  });

  it("reads a legacy date-only deadline as the end of that day", () => {
    expect(migrateSavedState(LEGACY_SAVE, true).workItems[0].dueDate).toBe("2026-08-30T23:59");
  });

  it("adds the fields later phases introduced, without inventing values", () => {
    const state = migrateSavedState(LEGACY_SAVE, true);

    expect(state.stages).toEqual([]);
    expect(state.activeSession).toBeNull();
    // Undefined, not false — an existing item defaults to personalization enabled.
    expect(state.workItems[0].usePersonalizedEstimate).toBeUndefined();
    // Undefined source means manually created; nothing pretends to be imported.
    expect(state.workItems[0].source).toBeUndefined();
  });

  it("never sends an existing user back through onboarding", () => {
    expect(migrateSavedState(LEGACY_SAVE, true).onboardingComplete).toBe(true);
  });

  it("treats a genuine first visit as needing onboarding", () => {
    expect(migrateSavedState(null, false).onboardingComplete).toBe(false);
  });

  it("treats an unparseable save as a damaged existing user, not a first-timer", () => {
    expect(migrateSavedState(null, true).onboardingComplete).toBe(true);
  });
});

describe("migrateSavedState — damaged saves degrade instead of crashing", () => {
  it("survives a save whose arrays are the wrong type", () => {
    const state = migrateSavedState(
      { workItems: "corrupted", commitments: 42, workSessions: null, stages: { nope: true }, feedback: undefined },
      true
    );

    expect(state.workItems).toEqual([]);
    expect(state.commitments).toEqual([]);
    expect(state.workSessions).toEqual([]);
    expect(state.stages).toEqual([]);
    expect(state.feedback).toEqual([]);
  });

  it("falls back to a usable planning profile when the stored one is missing or malformed", () => {
    expect(migrateSavedState({ workItems: [] }, true).planningProfile).toEqual(DEFAULT_PLANNING_PROFILE);
    expect(migrateSavedState({ planningProfile: "nope" }, true).planningProfile.workloadTolerance).toBe("moderate");
  });

  it("keeps availability an array even when the stored profile has it wrong", () => {
    const state = migrateSavedState({ planningProfile: { workStyle: "consistent", dailyAvailability: "broken" } }, true);
    expect(state.planningProfile.dailyAvailability).toEqual([]);
    expect(state.planningProfile.workStyle).toBe("consistent"); // real values still survive
  });

  it("survives a save that isn't an object at all", () => {
    for (const value of [42, "string", true, []]) {
      expect(() => migrateSavedState(value, true)).not.toThrow();
    }
  });

  it("drops non-object entries rather than letting them reach the engine", () => {
    const state = migrateSavedState({ workItems: [null, "junk", LEGACY_SAVE.workItems[0]] }, true);
    expect(state.workItems).toHaveLength(1);
    expect(state.workItems[0].title).toBe("Legacy Essay");
  });

  it("does not discard an activeSession that is genuinely present", () => {
    const active = { workItemId: "a1", workItemTitle: "Legacy Essay", startedAt: "2026-08-02T16:00" };
    expect(migrateSavedState({ ...LEGACY_SAVE, activeSession: active }, true).activeSession).toEqual(active);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildPlanningProfileFromOnboarding,
  DEFAULT_ONBOARDING_ANSWERS,
  isValidAvailabilityWindow,
} from "./onboarding";

describe("buildPlanningProfileFromOnboarding", () => {
  it("produces a valid PlanningProfile from default answers", () => {
    const profile = buildPlanningProfileFromOnboarding(DEFAULT_ONBOARDING_ANSWERS, "u1");
    expect(profile.userId).toBe("u1");
    expect(profile.workloadTolerance).toBe("moderate");
    expect(profile.breakPreference).toBe("balanced");
    expect(profile.freeTimePriority).toBe("medium");
    expect(profile.workStyle).toBe("early");
    expect(profile.defaultRigor).toBe("grade_level");
    expect(profile.dailyAvailability.length).toBe(7);
  });

  it("carries through every answer, not just the defaults", () => {
    const profile = buildPlanningProfileFromOnboarding(
      {
        rigor: "ap",
        workloadTolerance: "heavy",
        breakPreference: "frequent",
        freeTimePriority: "high",
        workStyle: "deadline_driven",
        dailyAvailability: [{ dayOfWeek: 1, earliest: "16:00", latest: "20:00" }],
      },
      "u2"
    );
    expect(profile.defaultRigor).toBe("ap");
    expect(profile.workloadTolerance).toBe("heavy");
    expect(profile.breakPreference).toBe("frequent");
    expect(profile.freeTimePriority).toBe("high");
    expect(profile.workStyle).toBe("deadline_driven");
    expect(profile.dailyAvailability).toEqual([{ dayOfWeek: 1, earliest: "16:00", latest: "20:00" }]);
  });
});

describe("isValidAvailabilityWindow", () => {
  it("accepts a normal window", () => {
    expect(isValidAvailabilityWindow("15:30", "21:00")).toBe(true);
  });

  it("rejects an end time at or before the start time", () => {
    expect(isValidAvailabilityWindow("21:00", "15:30")).toBe(false);
    expect(isValidAvailabilityWindow("15:30", "15:30")).toBe(false);
  });

  it("rejects malformed time strings", () => {
    expect(isValidAvailabilityWindow("3:30pm", "9pm")).toBe(false);
  });
});

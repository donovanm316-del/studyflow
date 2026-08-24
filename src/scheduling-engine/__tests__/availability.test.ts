import { describe, expect, it } from "vitest";
import { findAvailableWindows, subtractIntervals } from "../availability";
import { makeCommitment, makePlanningProfile } from "./fixtures";

describe("subtractIntervals", () => {
  it("splits a window around a busy interval in the middle", () => {
    const free = subtractIntervals({ startMinute: 0, endMinute: 100 }, [{ startMinute: 40, endMinute: 60 }]);
    expect(free).toEqual([
      { startMinute: 0, endMinute: 40 },
      { startMinute: 60, endMinute: 100 },
    ]);
  });

  it("merges overlapping busy intervals before subtracting", () => {
    const free = subtractIntervals({ startMinute: 0, endMinute: 100 }, [
      { startMinute: 10, endMinute: 30 },
      { startMinute: 20, endMinute: 50 },
    ]);
    expect(free).toEqual([
      { startMinute: 0, endMinute: 10 },
      { startMinute: 50, endMinute: 100 },
    ]);
  });
});

describe("findAvailableWindows", () => {
  it("returns nothing for a day with no dailyAvailability entry", () => {
    const profile = makePlanningProfile({ dailyAvailability: [{ dayOfWeek: 2, earliest: "15:00", latest: "20:00" }] });
    // 2026-08-24 is a Monday (dayOfWeek 1), which has no entry in the profile above.
    expect(findAvailableWindows("2026-08-24", profile, [], [])).toEqual([]);
  });

  it("subtracts a weekly commitment that falls on the requested day", () => {
    const profile = makePlanningProfile();
    const commitment = makeCommitment({ recurrence: { type: "weekly", daysOfWeek: [1] }, startTime: "16:00", endTime: "18:00" });
    const windows = findAvailableWindows("2026-08-24", profile, [commitment], []);
    expect(windows).toEqual([
      { startMinute: 15 * 60, endMinute: 16 * 60 },
      { startMinute: 18 * 60, endMinute: 21 * 60 },
    ]);
  });
});

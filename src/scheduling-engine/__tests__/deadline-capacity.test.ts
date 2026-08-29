import { describe, expect, it } from "vitest";
import {
  calculateAvailableMinutesBeforeDeadline,
  calculateDeadlineCapacity,
} from "../deadline-capacity";
import { hoursUntil, minutesUntil, normalizeDeadline } from "../date-utils";
import { makeCommitment, makePlanningProfile, NOW } from "./fixtures";
import type { ScheduleBlock } from "@/types/models";

// NOW is Monday 2026-08-24T08:00. The default fixture profile allows 15:00–21:00 every day (6h/day).
const PROFILE = makePlanningProfile();

describe("normalizeDeadline", () => {
  it("treats a legacy date-only deadline as 11:59 PM that day, not midnight", () => {
    expect(normalizeDeadline("2026-08-30")).toBe("2026-08-30T23:59");
  });

  it("preserves an explicit time", () => {
    expect(normalizeDeadline("2026-08-30T09:00")).toBe("2026-08-30T09:00");
  });

  it("trims seconds so stored values compare consistently", () => {
    expect(normalizeDeadline("2026-08-30T09:00:00")).toBe("2026-08-30T09:00");
  });

  it("is idempotent", () => {
    expect(normalizeDeadline(normalizeDeadline("2026-08-30"))).toBe("2026-08-30T23:59");
  });
});

describe("minutesUntil / hoursUntil", () => {
  it("measures to the exact timestamp, not the calendar day", () => {
    expect(hoursUntil("2026-08-24T18:00", "2026-08-24T23:59")).toBeCloseTo(5.98, 1);
    expect(hoursUntil("2026-08-24T18:00", "2026-08-25T23:59")).toBeCloseTo(29.98, 1);
  });

  it("goes negative once the deadline has passed", () => {
    expect(minutesUntil("2026-08-24T18:00", "2026-08-24T17:00")).toBe(-60);
  });
});

describe("calculateAvailableMinutesBeforeDeadline", () => {
  it("does not count sleep or other unavailable hours as usable time", () => {
    // Deadline is ~40 wall-clock hours away, but availability is only 15:00–21:00 each day.
    const deadline = "2026-08-25T23:59";
    const wallClockMinutes = minutesUntil(NOW, deadline);
    const available = calculateAvailableMinutesBeforeDeadline(deadline, NOW, PROFILE, [], []);

    expect(wallClockMinutes).toBeGreaterThan(2000);
    // Monday 15:00-21:00 (360) + Tuesday 15:00-21:00 (360) = 720.
    expect(available).toBe(720);
    expect(available).toBeLessThan(wallClockMinutes);
  });

  it("clips the deadline day at the deadline time itself", () => {
    // A test at 17:00 Tuesday leaves only 15:00-17:00 (120 min) that day.
    const available = calculateAvailableMinutesBeforeDeadline("2026-08-25T17:00", NOW, PROFILE, [], []);
    expect(available).toBe(360 + 120); // all of Monday + Tuesday up to 17:00
  });

  it("gives an 8 AM deadline far less same-day time than a 3 PM one", () => {
    const earlyExam = calculateAvailableMinutesBeforeDeadline("2026-08-25T08:00", NOW, PROFILE, [], []);
    const afternoonExam = calculateAvailableMinutesBeforeDeadline("2026-08-25T15:00", NOW, PROFILE, [], []);
    // Availability starts at 15:00, so an 8 AM exam adds no Tuesday time at all.
    expect(earlyExam).toBe(360);
    expect(afternoonExam).toBe(360);

    const lateAfternoonExam = calculateAvailableMinutesBeforeDeadline("2026-08-25T19:00", NOW, PROFILE, [], []);
    expect(lateAfternoonExam).toBeGreaterThan(earlyExam);
  });

  it("subtracts fixed commitments from the usable time", () => {
    const practice = makeCommitment({
      recurrence: { type: "weekly", daysOfWeek: [1] }, // Monday
      startTime: "16:00",
      endTime: "18:00",
    });
    const available = calculateAvailableMinutesBeforeDeadline("2026-08-24T21:00", NOW, PROFILE, [practice], []);
    expect(available).toBe(360 - 120); // Monday's 6h window minus 2h of practice
  });

  it("subtracts time already occupied by existing scheduled sessions", () => {
    const existing: ScheduleBlock = {
      id: "b1",
      userId: "u1",
      workItemId: "other",
      title: "Other work",
      start: "2026-08-24T15:00",
      end: "2026-08-24T16:00",
      origin: "manual-override",
      status: "planned",
    };
    const available = calculateAvailableMinutesBeforeDeadline("2026-08-24T21:00", NOW, PROFILE, [], [existing]);
    expect(available).toBe(360 - 60);
  });

  it("does not count hours that have already passed today", () => {
    // At 18:00 Monday, only 18:00-21:00 remains of that day's 15:00-21:00 window.
    const available = calculateAvailableMinutesBeforeDeadline("2026-08-24T21:00", "2026-08-24T18:00", PROFILE, [], []);
    expect(available).toBe(180);
  });

  it("returns zero for a deadline that has already passed", () => {
    expect(calculateAvailableMinutesBeforeDeadline("2026-08-23T23:59", NOW, PROFILE, [], [])).toBe(0);
  });

  it("caps each day at the daily capacity target when one is supplied", () => {
    const uncapped = calculateAvailableMinutesBeforeDeadline("2026-08-25T23:59", NOW, PROFILE, [], []);
    const capped = calculateAvailableMinutesBeforeDeadline("2026-08-25T23:59", NOW, PROFILE, [], [], {
      dailyCapacityMinutes: 120,
    });
    expect(uncapped).toBe(720);
    expect(capped).toBe(240); // 2 days x 120
  });

  it("respects a preferred start date by excluding earlier days", () => {
    const available = calculateAvailableMinutesBeforeDeadline("2026-08-25T23:59", NOW, PROFILE, [], [], {
      preferredStartDate: "2026-08-25",
    });
    expect(available).toBe(360); // Tuesday only
  });
});

describe("calculateDeadlineCapacity", () => {
  it("reports comfortable when there is clearly enough time", () => {
    const capacity = calculateDeadlineCapacity("w1", "2026-08-25T23:59", 60, NOW, PROFILE, [], []);
    expect(capacity.availableMinutes).toBe(720);
    expect(capacity.bufferMinutes).toBe(660);
    expect(capacity.risk).toBe("comfortable");
  });

  it("reports at-risk when the work genuinely does not fit before the deadline", () => {
    const capacity = calculateDeadlineCapacity("w1", "2026-08-24T21:00", 500, NOW, PROFILE, [], []);
    expect(capacity.availableMinutes).toBe(360);
    expect(capacity.bufferMinutes).toBe(-140);
    expect(capacity.risk).toBe("at-risk");
  });

  it("reports tight when the work only just fits, with no room for a session running long", () => {
    // 360 available; 330 needed leaves 30 min spare, under the 1.15x comfort factor.
    const capacity = calculateDeadlineCapacity("w1", "2026-08-24T21:00", 330, NOW, PROFILE, [], []);
    expect(capacity.risk).toBe("tight");
    expect(capacity.bufferMinutes).toBe(30);
  });

  it("treats exactly-enough time as tight rather than safe", () => {
    const capacity = calculateDeadlineCapacity("w1", "2026-08-24T21:00", 360, NOW, PROFILE, [], []);
    expect(capacity.bufferMinutes).toBe(0);
    expect(capacity.risk).toBe("tight");
  });

  it("reports overdue when the deadline has passed and work remains", () => {
    const capacity = calculateDeadlineCapacity("w1", "2026-08-23T23:59", 60, NOW, PROFILE, [], []);
    expect(capacity.risk).toBe("overdue");
    expect(capacity.minutesUntilDeadline).toBeLessThan(0);
  });

  it("flags a deadline inside the next 24 hours as imminent", () => {
    expect(calculateDeadlineCapacity("w1", "2026-08-24T21:00", 60, NOW, PROFILE, [], []).imminent).toBe(true);
    expect(calculateDeadlineCapacity("w1", "2026-08-27T21:00", 60, NOW, PROFILE, [], []).imminent).toBe(false);
  });

  it("normalizes a legacy date-only deadline to the end of that day", () => {
    const capacity = calculateDeadlineCapacity("w1", "2026-08-25", 60, NOW, PROFILE, [], []);
    expect(capacity.deadline).toBe("2026-08-25T23:59");
  });
});

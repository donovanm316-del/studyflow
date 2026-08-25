import { describe, expect, it } from "vitest";
import { calculateWorkloadStatus } from "../workload-status";
import { makeAssignment } from "./fixtures";

describe("calculateWorkloadStatus", () => {
  it("matches the spec's worked example: 7h20m remaining / 9h available reads as on-track", () => {
    const entries = [{ item: makeAssignment(), remainingMinutes: 7 * 60 + 20 }];
    const status = calculateWorkloadStatus(entries, 9 * 60, false);
    expect(status.level).toBe("on-track");
    expect(status.bufferMinutes).toBe(9 * 60 - (7 * 60 + 20));
  });

  it("matches the spec's worked example: 7h20m remaining / 4h30m available reads as at-risk", () => {
    const entries = [{ item: makeAssignment(), remainingMinutes: 7 * 60 + 20 }];
    const status = calculateWorkloadStatus(entries, 4 * 60 + 30, false);
    expect(status.level).toBe("at-risk");
    expect(status.message).toMatch(/at risk/i);
    expect(status.message).toMatch(/7h 20m/);
    expect(status.message).toMatch(/4h 30m/);
  });

  it("reports 'ahead' when there is no remaining work, regardless of available time", () => {
    const status = calculateWorkloadStatus([], 0, false);
    expect(status.level).toBe("ahead");
  });

  it("is forced to 'at-risk' by an unscheduled hard deadline even if the ratio looks fine", () => {
    const entries = [{ item: makeAssignment(), remainingMinutes: 30 }];
    const status = calculateWorkloadStatus(entries, 600, true);
    expect(status.level).toBe("at-risk");
  });

  it("reports 'getting-tight' just past the on-track threshold, before it becomes at-risk", () => {
    const entries = [{ item: makeAssignment(), remainingMinutes: 95 }];
    const status = calculateWorkloadStatus(entries, 100, false); // ratio 0.95
    expect(status.level).toBe("getting-tight");
  });
});

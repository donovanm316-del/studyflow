import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-text guard for the stage-minutes fields' string-backed fix (Phase 6A, Part 5) — same
 * "controlled numeric input snaps to a literal 0 when cleared" bug class already fixed in
 * `WorkItemModal.tsx`, applied here to the two standalone stage-minutes forms.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/components/tasks/StageManager.tsx"), "utf8");

describe("StageManager minutes fields (empty, not zero)", () => {
  it("no longer seeds the edit-minutes field with a numeric 0", () => {
    expect(SOURCE).not.toMatch(/useState\(0\)/);
  });

  it("the edit-minutes field is string-backed and starts empty", () => {
    expect(SOURCE).toMatch(/editMinutesInput.*useState\(""\)/);
  });

  it("the new-stage minutes field is string-backed and starts empty, not defaulted to 20", () => {
    expect(SOURCE).not.toMatch(/useState\(20\)/);
    expect(SOURCE).toMatch(/minutesInput.*useState\(""\)/);
  });

  it("validates a positive number before Save/Add is enabled", () => {
    expect(SOURCE).toMatch(/editMinutesValid\s*=\s*editMinutesInput\.trim\(\) !== "" && Number\.isFinite\(editMinutes\) && editMinutes > 0/);
    expect(SOURCE).toMatch(/minutesValid\s*=\s*minutesInput\.trim\(\) !== "" && Number\.isFinite\(minutes\) && minutes > 0/);
  });
});

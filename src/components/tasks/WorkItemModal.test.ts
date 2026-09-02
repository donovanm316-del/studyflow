import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-text guard for the "Estimated minutes" field fix (Phase 5D, Part 13/19 Scenario I) — this
 * project has no DOM testing library, so component *behavior* that hinges on exact control-flow
 * (not just markup) is guarded the same way `Modal.test.ts`/`ScheduleBlockCard.test.ts` already do.
 *
 * The bug: the field was bound to a numeric `useState`, defaulting new items to a nonzero number
 * and — worse — snapping back to a literal "0" the instant a student cleared it to type their own
 * value, since `Number("") === 0` re-renders the controlled input showing "0". The fix binds the
 * field to a string that starts empty for a new item, and validates a positive number on submit
 * rather than silently coercing an empty field into 0.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/components/tasks/WorkItemModal.tsx"), "utf8");

describe("WorkItemModal estimate field (empty, not zero)", () => {
  it("starts a new item's estimate field empty rather than defaulting to a number", () => {
    expect(SOURCE).toMatch(/estimatedMinutesInput[\s\S]*?useState\(\s*\n?\s*initial\?\.estimatedMinutes != null \? String\(initial\.estimatedMinutes\) : ""/);
  });

  it("no longer binds the field directly to a numeric state (the 0-snapback bug)", () => {
    expect(SOURCE).not.toMatch(/useState\(initial\?\.estimatedMinutes \?\? 30\)/);
  });

  it("treats an empty field as no estimate, not as zero, when validating on submit", () => {
    expect(SOURCE).toMatch(/estimatedMinutesInput\.trim\(\) === "" \? NaN : Number\(estimatedMinutesInput\)/);
  });

  it("rejects a non-positive estimate rather than silently accepting it", () => {
    expect(SOURCE).toMatch(/!Number\.isFinite\(estimatedMinutes\) \|\| estimatedMinutes <= 0/);
  });

  it("shows a real placeholder instead of a pre-filled value", () => {
    expect(SOURCE).toContain('placeholder="e.g. 45"');
  });
});

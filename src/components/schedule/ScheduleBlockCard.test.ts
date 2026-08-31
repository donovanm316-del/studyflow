import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A guard on the card's layout classes, in the same spirit as `Modal.test.ts` — this project has
 * no DOM testing library, and the bug being guarded against was purely a CSS one.
 *
 * The bug: the title/timestamp block and the `actions` slot shared one row with the actions group
 * marked `shrink-0`. On a narrow phone, a title long enough to need the available space (or even a
 * normal title next to three action buttons) left the unshrinkable actions group with nowhere to
 * go but off the right edge of the viewport. Verified fixed at 375px and 390px, with both a normal
 * and a long (Classroom-imported) title, in both the active- and inactive-session states.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/components/schedule/ScheduleBlockCard.tsx"), "utf8");

describe("ScheduleBlockCard layout (mobile reachability)", () => {
  it("lets the title and actions row wrap instead of forcing a fixed-width overflow", () => {
    expect(SOURCE).toMatch(/flex\s+flex-wrap\s+items-start\s+justify-between\s+gap-2/);
  });

  it("no longer marks the header row as non-wrapping", () => {
    // The specific bug: `flex items-start justify-between gap-2` with no `flex-wrap` on this row.
    expect(SOURCE).not.toMatch(/<div className="flex items-start justify-between gap-2">/);
  });
});

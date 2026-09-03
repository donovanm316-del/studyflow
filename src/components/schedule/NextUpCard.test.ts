import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-text guard for the "Next up" vs. "Your next move" header framing (Phase 6B, Part 1/12) —
 * this project has no DOM testing library, so the branch itself is guarded here the same way
 * `ScheduleBlockCard.test.ts` guards its own component. `deriveScheduleState`'s actual logic is
 * exercised directly in `schedule-freshness.test.ts`; this only checks the card reads it.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/components/schedule/NextUpCard.tsx"), "utf8");

describe("NextUpCard header framing", () => {
  it("only reads 'urgent' from behind/at-risk schedule states", () => {
    expect(SOURCE).toContain('const urgent = state === "behind" || state === "at-risk";');
  });

  it("renders the urgent header only when that's true", () => {
    expect(SOURCE).toContain('{urgent ? "Your next move" : "Next up"}');
  });

  it("defaults to the calm header when no state is passed (existing callers unaffected)", () => {
    // `state` is optional and `urgent` is false for `undefined`, so omitting it entirely must not
    // throw and must fall through to "Next up".
    expect(SOURCE).toMatch(/state\?:\s*ScheduleState/);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-text guard for the Today page's session action group (Start / Log without timer / Can't
 * do this today) — a companion to `ScheduleBlockCard.test.ts`, which guards the card's own row.
 * Both halves of the fix have to hold: the card's row must be allowed to wrap, and this group must
 * be willing to take the full row width on a narrow screen rather than declaring itself unshrinkable.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/app/(app)/today/page.tsx"), "utf8");

describe("Today page session actions (mobile reachability)", () => {
  it("lets the action group take the full row width on narrow screens", () => {
    expect(SOURCE).toContain('className="flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto"');
  });

  it("no longer marks the action group as shrink-0", () => {
    expect(SOURCE).not.toMatch(/shrink-0 flex-wrap items-center gap-1"/);
  });

  it("reverts to an inline group once there's room (desktop unchanged)", () => {
    expect(SOURCE).toContain("sm:w-auto");
  });
});

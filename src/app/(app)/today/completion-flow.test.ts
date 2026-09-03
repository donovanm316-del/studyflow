import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-text guard for the "finish a session" completion flow (Phase 6A, Part 5/6). Covers two
 * things together since they're the same fix applied to the same field:
 *
 *  - The actual-time field is string-backed (`minutesInput`), so clearing it to retype doesn't
 *    snap back to a literal "0" — the same bug class fixed in `WorkItemModal.tsx`.
 *  - The four-step "finish" copy from the spec: an acknowledgement, planned-vs-actual, what was
 *    learned, and (elsewhere, via `buildEarlyFinishSummary`) what to do with freed time.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/app/(app)/today/page.tsx"), "utf8");

describe("Today page completion flow", () => {
  it("acknowledges the finished session before asking for actual time", () => {
    expect(SOURCE).toContain("Nice — you finished this session.");
    expect(SOURCE).toContain("How long did it actually take?");
  });

  it("the actual-time field is string-backed, not a numeric state prone to snapping to 0", () => {
    expect(SOURCE).toMatch(/minutesInput:\s*string/);
    expect(SOURCE).toContain("value={completion.minutesInput}");
    expect(SOURCE).toContain("onChange={(e) => setCompletion({ ...completion, minutesInput: e.target.value })}");
  });

  it("Continue is disabled until a valid positive number is entered", () => {
    expect(SOURCE).toMatch(/disabled=\{!completion\.minutesInput\.trim\(\) \|\| Number\(completion\.minutesInput\) <= 0\}/);
  });

  it("shows planned vs. actual time once both are known", () => {
    expect(SOURCE).toMatch(/Planned: \{justCompleted\.planned\} min/);
    expect(SOURCE).toMatch(/Actual: \{justCompleted\.actual\} min/);
  });

  it("explains what was learned from the timing difference", () => {
    expect(SOURCE).toMatch(/We&apos;ll use this/);
  });
});

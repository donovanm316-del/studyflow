import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-text guard for the "Connect Classroom → Import schoolwork" continuity fix (Phase 6A,
 * Part 4) — right after the OAuth redirect reports a successful connection, the sync review opens
 * automatically instead of leaving the student to notice and click "Sync now" themselves. Nothing
 * is imported until they confirm inside that review (`ClassroomSyncModal` only writes on `apply()`,
 * covered by its own tests) — this only guards that the modal is actually offered.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/components/settings/GoogleClassroomCard.tsx"), "utf8");

describe("GoogleClassroomCard post-connect continuity", () => {
  it("opens the sync review automatically right after a successful connection", () => {
    const connectedBranch = SOURCE.slice(
      SOURCE.indexOf('if (result === "connected")'),
      SOURCE.indexOf("} else {")
    );
    expect(connectedBranch).toContain("setSyncOpen(true)");
  });

  it("shows the student-facing explainer whenever Classroom is configured", () => {
    expect(SOURCE).toContain("<ClassroomExplainer");
    expect(SOURCE).toContain("status?.configured && <ClassroomExplainer");
  });
});

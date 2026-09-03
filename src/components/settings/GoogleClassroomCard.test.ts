import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-text guard for the "Connect Classroom → Import schoolwork" continuity fix (Phase 6A,
 * Part 4) — right after the OAuth redirect reports a successful connection, the sync review opens
 * automatically instead of leaving the student to notice and click "Sync Google Classroom" themselves. Nothing
 * is imported until they confirm inside that review (`ClassroomSyncModal` only writes on `apply()`,
 * covered by its own tests) — this only guards that the modal is actually offered.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/components/settings/GoogleClassroomCard.tsx"), "utf8");

describe("GoogleClassroomCard post-connect continuity", () => {
  it("opens the sync review automatically right after a successful connection", () => {
    // Bounded by the redirect-handling effect's own branches, not the first "} else {" in the
    // file — other functions above this effect (e.g. `summarizeSync`) have their own unrelated
    // if/else blocks that would otherwise cut the slice short.
    const connectedIdx = SOURCE.indexOf('if (result === "connected")');
    const oauthFailureIdx = SOURCE.indexOf('params.get("reason")');
    expect(connectedIdx).toBeGreaterThan(-1);
    expect(oauthFailureIdx).toBeGreaterThan(connectedIdx);
    const connectedBranch = SOURCE.slice(connectedIdx, oauthFailureIdx);
    expect(connectedBranch).toContain("setSyncOpen(true)");
  });

  it("shows the student-facing explainer whenever Classroom is configured", () => {
    expect(SOURCE).toContain("<ClassroomExplainer");
    expect(SOURCE).toContain("status?.configured && <ClassroomExplainer");
  });
});

describe("GoogleClassroomCard sync summary (Phase 6B, Part 9)", () => {
  it("names a handful of newly imported items with their real due date and estimate", () => {
    expect(SOURCE).toMatch(/importedItems\.length > 0 && importedItems\.length <= 3/);
    expect(SOURCE).toContain("formatDueLabel(i.dueDate, today)");
    expect(SOURCE).toContain("formatMinutesAsHoursMinutes(i.estimatedMinutes)");
  });

  it("falls back to a plain count once there are more than a few imports", () => {
    expect(SOURCE).toMatch(/Imported \$\{imported\} assignment\$\{imported === 1 \? "" : "s"\}`\);\s*\n\s*\}/);
  });
});

describe("GoogleClassroomCard connected state (Phase 6B, Part 10)", () => {
  it("shows explicit, always-visible 'can' and 'cannot' capability bullets", () => {
    expect(SOURCE).toContain("StudyFlow can</p>");
    expect(SOURCE).toContain("StudyFlow cannot</p>");
    expect(SOURCE).toContain("Read your classes");
    expect(SOURCE).toContain("Change Classroom assignments");
  });

  it("labels the sync action clearly", () => {
    expect(SOURCE).toContain("Sync Google Classroom");
  });
});

describe("GoogleClassroomCard disconnect preserves StudyFlow data (Phase 6B, Part 15)", () => {
  it("disconnect() only calls the API and local UI state — never a store-mutating action", () => {
    const start = SOURCE.indexOf("async function disconnect()");
    const end = SOURCE.indexOf("\n  }", start);
    const body = SOURCE.slice(start, end);
    expect(body).toContain(`fetch(\`\${API}/disconnect\`, { method: "POST" })`);
    // None of the store's write actions this component has access to (from `useAppData()`) appear
    // in the disconnect handler — disconnecting only ever removes StudyFlow's *access*, never any
    // of the student's own assignments, sessions, or history.
    for (const storeAction of ["removeWorkItem", "updateWorkItem", "addWorkItem", "applyClassroomSync", "setClassroomCourseIds"]) {
      expect(body).not.toContain(`${storeAction}(`);
    }
  });
});

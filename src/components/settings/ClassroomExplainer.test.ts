import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 6A, Part 1/2 — Settings must clearly explain what StudyFlow gets from Google Classroom,
 * what it explicitly does not get or do, and how to connect it, in plain student-facing language.
 * Source-guarded (no DOM testing library in this project) the same way other presentational
 * components are.
 */
const SOURCE = readFileSync(join(process.cwd(), "src/components/settings/ClassroomExplainer.tsx"), "utf8");
/** Just the rendered JSX — excludes the file's own doc comment, which is allowed to talk shop. */
const RENDERED = SOURCE.slice(SOURCE.indexOf("export function"));

describe("ClassroomExplainer content", () => {
  it("explains what StudyFlow gets from Classroom", () => {
    expect(SOURCE).toContain("What StudyFlow gets");
    expect(SOURCE).toContain("Your enrolled classes");
    expect(SOURCE).toContain("Assignment titles");
    expect(SOURCE).toContain("Due dates and times");
  });

  it("explains what StudyFlow explicitly does not get or do", () => {
    expect(SOURCE).toContain("does not get or do");
    expect(SOURCE).toMatch(/Cannot change, complete, or submit/);
    expect(SOURCE).toMatch(/Cannot see or change grades/);
    expect(SOURCE).toMatch(/Cannot modify anything in Google Classroom/);
    expect(SOURCE).toMatch(/Cannot access teacher tools/);
    expect(SOURCE).toMatch(/Cannot see other students/);
  });

  it("gives a concise, non-technical step-by-step connection guide", () => {
    expect(SOURCE).toContain("Connect Google Classroom");
    expect(SOURCE).toContain("Connect Google Classroom");
    expect(SOURCE).toMatch(/secure sign-in page/);
    expect(RENDERED).not.toMatch(/OAuth|redirect URI|client secret|scope string/i);
  });
});

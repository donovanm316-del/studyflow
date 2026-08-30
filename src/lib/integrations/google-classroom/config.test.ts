import { describe, expect, it } from "vitest";
import {
  CLASSROOM_COURSES_READONLY_SCOPE,
  CLASSROOM_COURSEWORK_READONLY_SCOPE,
  isClassroomConfigured,
  MIN_SESSION_SECRET_LENGTH,
  readGoogleConfig,
  REQUESTED_SCOPES,
} from "./config";

const SECRET = "x".repeat(MIN_SESSION_SECRET_LENGTH);

const COMPLETE = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REDIRECT_URI: "https://example.test/api/integrations/google-classroom/callback",
  STUDYFLOW_SESSION_SECRET: SECRET,
};

describe("configuration detection", () => {
  it("reads a complete configuration", () => {
    const result = readGoogleConfig(COMPLETE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.clientId).toBe("client-id");
  });

  it("reports an entirely unconfigured deployment rather than throwing", () => {
    // The whole point: a developer who cloned the repo and ran `npm run dev` must not hit a crash.
    const result = readGoogleConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual([
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI",
      "STUDYFLOW_SESSION_SECRET",
    ]);
  });

  it("names each individually missing variable", () => {
    for (const name of Object.keys(COMPLETE)) {
      const partial = { ...COMPLETE, [name]: undefined };
      const result = readGoogleConfig(partial);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.missing).toEqual([name]);
    }
  });

  it("treats blank and whitespace-only values as missing", () => {
    const result = readGoogleConfig({ ...COMPLETE, GOOGLE_CLIENT_SECRET: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["GOOGLE_CLIENT_SECRET"]);
  });

  it("rejects a session secret too short to be worth encrypting with", () => {
    const result = readGoogleConfig({ ...COMPLETE, STUDYFLOW_SESSION_SECRET: "short" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toEqual(["STUDYFLOW_SESSION_SECRET"]);
  });

  it("never echoes a credential value in what it reports as missing", () => {
    // `missing` is rendered in the Settings UI. It must carry variable names and nothing else.
    const result = readGoogleConfig({ ...COMPLETE, GOOGLE_CLIENT_ID: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing.join(" ")).not.toContain("client-secret");
      expect(result.missing.join(" ")).not.toContain(SECRET);
    }
  });

  it("trims surrounding whitespace, which pasted credentials routinely carry", () => {
    const result = readGoogleConfig({ ...COMPLETE, GOOGLE_CLIENT_ID: "  client-id\n" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.clientId).toBe("client-id");
  });

  it("exposes configuration state as a boolean for callers that only need that", () => {
    expect(isClassroomConfigured(COMPLETE)).toBe(true);
    expect(isClassroomConfigured({})).toBe(false);
  });
});

describe("requested OAuth scopes", () => {
  it("requests read-only courses and read-only coursework, and nothing else", () => {
    // Both are used by code that exists: courses for the class list, coursework for the import.
    expect([...REQUESTED_SCOPES]).toEqual([CLASSROOM_COURSES_READONLY_SCOPE, CLASSROOM_COURSEWORK_READONLY_SCOPE]);
  });

  it("requests only the student's own coursework, never other students'", () => {
    expect(CLASSROOM_COURSEWORK_READONLY_SCOPE).toContain("coursework.me");
  });

  it("requests no write, teacher, roster, submission, or identity scope", () => {
    // `.students` covers the teacher-facing coursework and submission scopes; `student-submissions`
    // would reveal turn-in state, which StudyFlow deliberately does not read.
    const forbidden = [".students", ".rosters", "announcements", "profile.emails", "student-submissions"];
    for (const scope of REQUESTED_SCOPES) {
      expect(scope.endsWith(".readonly")).toBe(true);
      for (const fragment of forbidden) expect(scope).not.toContain(fragment);
    }
  });

  it("requests no scope that could modify Google Classroom", () => {
    // The `.readonly` suffix is the guarantee; its absence is what write access looks like.
    for (const scope of REQUESTED_SCOPES) {
      expect(scope).toMatch(/^https:\/\/www\.googleapis\.com\/auth\/classroom\.[a-z.]+\.readonly$/);
    }
  });
});

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateSchedule } from "@/scheduling-engine";
import { migrateSavedState } from "@/lib/data/migrate";
import { normalizeExternalItem } from "@/lib/data/import";
import { makeAssignment, makePlanningProfile, NOW } from "@/scheduling-engine/__tests__/fixtures";

/**
 * Two guarantees Phase 5A must not break, checked against the source tree itself.
 *
 * The first is **containment**: credentials stay on the server and the Classroom integration stays
 * out of everything that was already working. A leak here is silent — the app looks fine while a
 * client secret sits in a JavaScript bundle served to every visitor — so it is asserted rather than
 * left to review.
 *
 * The second is **backward compatibility**: a student who has never heard of Google Classroom, and
 * a deployment with no Google credentials at all, must see StudyFlow behave exactly as before.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join(SRC, f));
}

const FILES = sourceFiles().map((path) => ({ path, text: readFileSync(path, "utf8") }));

/**
 * Source with comments removed.
 *
 * Needed because several of these files *document* the rule they follow — `session.ts` explains at
 * length why it does not use `localStorage`. Scanning raw text would flag the explanation as a
 * violation, so the checks below run against code only.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** The modules that read a secret or handle a token. None may be reachable from the browser. */
const SERVER_ONLY = ["google-classroom/config", "google-classroom/session", "google-classroom/oauth", "google-classroom/client", "google-classroom/service"];

describe("credential containment", () => {
  it("never marks a Google or session variable as NEXT_PUBLIC", () => {
    // Next.js inlines NEXT_PUBLIC_* into the client bundle. One of these on a secret publishes it.
    for (const { path, text } of FILES) {
      expect(code(text), path).not.toMatch(/NEXT_PUBLIC_(GOOGLE|STUDYFLOW_SESSION)/);
    }
  });

  it("keeps every server-only module out of client components", () => {
    const clientComponents = FILES.filter((f) => /^\s*["']use client["']/m.test(f.text));
    expect(clientComponents.length).toBeGreaterThan(0); // guard against the filter silently matching nothing

    for (const { path, text } of clientComponents) {
      for (const serverModule of SERVER_ONLY) expect(code(text), `${path} imports ${serverModule}`).not.toContain(serverModule);
    }
  });

  it("does not re-export the server-only modules from the integration's public barrel", () => {
    // A barrel that pulled these in would let one careless import drag a secret into the bundle.
    const barrel = readFileSync(join(SRC, "lib/integrations/google-classroom/index.ts"), "utf8");
    for (const serverModule of SERVER_ONLY) expect(barrel).not.toContain(serverModule.replace("google-classroom/", "./"));
  });

  it("stores no Google data in localStorage", () => {
    // localStorage is readable by every script on the page. Tokens live in an encrypted httpOnly
    // cookie instead; see session.ts.
    const integrationAndRoutes = FILES.filter((f) => f.path.includes("google-classroom"));
    expect(integrationAndRoutes.length).toBeGreaterThan(0);
    for (const { path, text } of integrationAndRoutes) {
      expect(code(text), path).not.toContain("localStorage");
      expect(code(text), path).not.toContain("sessionStorage");
    }
  });

  it("ships no real credential in the committed example environment file", () => {
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    for (const line of example.split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))) {
      expect(line.split("=")[1].trim(), line).toBe("");
    }
  });

  it("keeps .env.local ignored while allowing the example through", () => {
    const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^\.env\*$/m);
    // The negation has to sit below every `.env*` rule or git ignores the exception.
    const lines = gitignore.split("\n").map((l) => l.trim());
    expect(lines.lastIndexOf("!.env.example")).toBeGreaterThan(lines.lastIndexOf(".env*"));
  });
});

describe("read-only access to Classroom", () => {
  it("issues no write request to the Classroom API", () => {
    // Read-only is enforced twice: by the OAuth scope, and by there being no code that could write.
    const client = readFileSync(join(SRC, "lib/integrations/google-classroom/client.ts"), "utf8");
    expect(client).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  });

  it("posts only to Google's own OAuth endpoints, never to Classroom", () => {
    const oauth = readFileSync(join(SRC, "lib/integrations/google-classroom/oauth.ts"), "utf8");
    expect(oauth).not.toContain("classroom.googleapis.com");
  });
});

describe("the scheduling engine is untouched by this phase", () => {
  it("contains no reference to Google Classroom or to the integrations layer", () => {
    // The engine stays the single source of truth for scheduling and stays source-agnostic —
    // provenance must never change how work is planned.
    for (const { path, text } of FILES.filter((f) => f.path.includes("scheduling-engine"))) {
      expect(text, path).not.toMatch(/google|classroom|integrations/i);
    }
  });

  it("schedules an item carrying Classroom provenance identically to a plain one", () => {
    const base = { title: "Lab report", dueDate: "2026-08-27T23:59:00", estimatedMinutes: 90 };
    const input = (extra: object) => ({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-27",
      now: NOW,
      workItems: [makeAssignment({ ...base, id: "same-id", ...extra })],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    const plain = generateSchedule(input({}));
    const imported = generateSchedule(
      input({ source: "google-classroom", externalId: "cw-1", externalCourseId: "123456", externalUrl: "https://classroom.google.com/c/1/a/2" })
    );

    // Block ids are generated per run, so compare everything except them.
    const shape = (blocks: typeof plain.blocks) =>
      blocks.map((b) => ({ start: b.start, end: b.end, title: b.title, origin: b.origin, status: b.status }));

    expect(plain.blocks.length).toBeGreaterThan(0); // otherwise this compares two empty schedules
    expect(shape(imported.blocks)).toEqual(shape(plain.blocks));
    expect(imported.priorities).toEqual(plain.priorities);
  });
});

describe("StudyFlow without a Google connection", () => {
  it("loads a saved state written before this phase existed", () => {
    // Nothing in Phase 5A added a required field, so pre-5A localStorage must load untouched.
    const legacy = {
      workItems: [
        {
          id: "a1",
          userId: "demo-user",
          title: "Essay draft",
          dueDate: "2026-09-04", // pre-4.5A date-only deadline
          status: "not-started",
          estimatedMinutes: 60,
          weight: "medium",
          deadlineStrictness: "important",
          workType: "essay",
          kind: "assignment",
          createdAt: "2026-08-01",
          updatedAt: "2026-08-01",
        },
      ],
    };

    const state = migrateSavedState(legacy, true);
    expect(state.workItems).toHaveLength(1);
    expect(state.workItems[0].title).toBe("Essay draft");
    expect(state.workItems[0].dueDate).toBe("2026-09-04T23:59");
    // Absent, not defaulted — an item that never came from anywhere has no source.
    expect(state.workItems[0].source).toBeUndefined();
    expect(state.workItems[0].externalCourseId).toBeUndefined();
  });

  it("still plans normally for a student who never connects anything", () => {
    const result = generateSchedule({
      userId: "u1",
      rangeStart: "2026-08-24",
      rangeEnd: "2026-08-26",
      now: NOW,
      workItems: [makeAssignment({ title: "Math problems", dueDate: "2026-08-26T23:59:00", estimatedMinutes: 60 })],
      commitments: [],
      planningProfile: makePlanningProfile(),
    });

    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.unscheduledWorkItemIds).toEqual([]);
  });

  it("loads a Phase 5A save that predates course selection", () => {
    const state = migrateSavedState({ workItems: [], onboardingComplete: true }, true);
    // Empty reads as "all active courses" — the same thing a newly-connected student gets.
    expect(state.classroomCourseIds).toEqual([]);
    expect(state.classroomLastSyncAt).toBeUndefined();
  });

  it("survives a damaged course selection without losing the student's work", () => {
    const state = migrateSavedState(
      { workItems: [], classroomCourseIds: "not-an-array", classroomLastSyncAt: 42 },
      true
    );
    expect(state.classroomCourseIds).toEqual([]);
    expect(state.classroomLastSyncAt).toBeUndefined();
  });
});

describe("data safety", () => {
  it("fabricates no session history for imported work", () => {
    // An assignment that arrived from Classroom this morning has no past. Inventing sessions would
    // corrupt Insights and the personalized-estimate history in one stroke (Part 26).
    const input = normalizeExternalItem(
      { source: "google-classroom", externalId: "cw-1", externalCourseId: "c1", title: "Reading", dueDate: "2026-09-04T15:00" },
      "2026-08-24"
    )!;

    const record = input as unknown as Record<string, unknown>;
    expect(record.actualMinutes).toBeUndefined();
    expect(record.status).toBeUndefined(); // the store sets "not-started"; nothing is pre-filled here
    expect(migrateSavedState({ workItems: [{ ...input, id: "i1" }] }, true).workSessions).toEqual([]);
  });

  it("writes no Google token or credential into the persisted app state", () => {
    // The refresh token lives in an encrypted httpOnly cookie. Nothing about the connection is
    // allowed to reach the localStorage blob.
    const state = migrateSavedState({ workItems: [], classroomCourseIds: ["c1"], classroomLastSyncAt: "2026-08-30T12:00:00.000Z" }, true);
    const serialized = JSON.stringify(state);
    expect(serialized).not.toMatch(/refreshToken|accessToken|client_secret|ya29|1\/\//);
  });

  it("keeps the sync-tracking fields to the minimum reconciliation needs", () => {
    // Part 29: a comparison baseline, not a cached copy of the API response. Descriptions,
    // instructions, and raw Google payloads are deliberately not persisted onto the work item.
    const input = normalizeExternalItem(
      {
        source: "google-classroom",
        externalId: "cw-1",
        externalCourseId: "c1",
        title: "Reading",
        dueDate: "2026-09-04T15:00",
        courseName: "AP Biology",
        description: "A long set of instructions that StudyFlow has no reason to keep a copy of.",
        sourceUpdatedAt: "2026-08-30T12:00:00.000Z",
      },
      "2026-08-24"
    )!;

    expect(Object.keys(input.sourceSnapshot!).sort()).toEqual(["courseName", "dueDate", "title"]);
    expect(JSON.stringify(input)).not.toContain("no reason to keep");
  });
});

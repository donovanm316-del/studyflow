import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listCourseWork } from "./client";
import { fetchCourseWork } from "./service";
import { ClassroomError } from "./errors";
import { sealSession, type ClassroomSession } from "./session";
import type { GoogleListCourseWorkResponse } from "./types";

const ENDPOINT = "https://classroom.test/v1/courses";
const SESSION_SECRET = "a-test-session-secret-at-least-32-chars";

const CONFIGURED_ENV = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REDIRECT_URI: "https://studyflow.test/api/integrations/google-classroom/callback",
  STUDYFLOW_SESSION_SECRET: SESSION_SECRET,
};

const SESSION: ClassroomSession = {
  refreshToken: "1//refresh-token",
  grantedScopes: [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  ],
  connectedAt: "2026-08-30T10:00:00.000Z",
};

const ORIGINAL_ENV = { ...process.env };

function setEnv(vars: Record<string, string | undefined>) {
  for (const key of Object.keys(CONFIGURED_ENV)) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) if (value !== undefined) process.env[key] = value;
}

beforeEach(() => setEnv(CONFIGURED_ENV));
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Serves a scripted sequence of coursework pages, recording every URL requested. */
function pagingFetch(pages: GoogleListCourseWorkResponse[]) {
  let call = 0;
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL) => {
    urls.push(String(url));
    return jsonResponse(pages[Math.min(call++, pages.length - 1)]);
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

describe("coursework retrieval", () => {
  it("returns normalized coursework for a course", async () => {
    const { fetchImpl } = pagingFetch([
      {
        courseWork: [
          {
            id: "cw-1",
            courseId: "c1",
            title: "Chapter 7 Reading",
            state: "PUBLISHED",
            workType: "ASSIGNMENT",
            dueDate: { year: 2026, month: 9, day: 4 },
            dueTime: { hours: 22, minutes: 0 },
            alternateLink: "https://classroom.google.com/c/c1/a/cw-1",
            updateTime: "2026-08-30T12:00:00.000Z",
          },
        ],
      },
    ]);

    const items = await listCourseWork("token", "c1", { fetchImpl, endpoint: ENDPOINT, course: { name: "AP Biology" } });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      source: "google-classroom",
      externalId: "cw-1",
      externalCourseId: "c1",
      title: "Chapter 7 Reading",
      courseName: "AP Biology",
      hasExactDeadline: true,
      workTypeHint: "assignment",
      sourceState: "active",
      sourceUpdatedAt: "2026-08-30T12:00:00.000Z",
    });
  });

  it("requests the coursework sub-resource of the right course, with the token as a header", async () => {
    const { fetchImpl, urls } = pagingFetch([{}]);
    await listCourseWork("secret-token", "c1", { fetchImpl, endpoint: ENDPOINT });

    expect(urls[0]).toContain("/c1/courseWork");
    expect(urls[0]).not.toContain("secret-token");
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
  });

  it("issues no request that could modify Classroom", async () => {
    const { fetchImpl } = pagingFetch([{}]);
    await listCourseWork("token", "c1", { fetchImpl, endpoint: ENDPOINT });
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit | undefined];
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
  });

  it("escapes a course id rather than splicing it into the path raw", async () => {
    const { fetchImpl, urls } = pagingFetch([{}]);
    await listCourseWork("token", "a/b?c", { fetchImpl, endpoint: ENDPOINT });
    expect(urls[0]).toContain("a%2Fb%3Fc");
  });

  it("follows pagination across pages", async () => {
    const { fetchImpl, urls } = pagingFetch([
      { courseWork: [{ id: "cw-1", title: "One", state: "PUBLISHED" }], nextPageToken: "p2" },
      { courseWork: [{ id: "cw-2", title: "Two", state: "PUBLISHED" }], nextPageToken: "p3" },
      { courseWork: [{ id: "cw-3", title: "Three", state: "PUBLISHED" }] },
    ]);

    const items = await listCourseWork("token", "c1", { fetchImpl, endpoint: ENDPOINT });
    expect(items.map((i) => i.title)).toEqual(["One", "Two", "Three"]);
    expect(urls).toHaveLength(3);
    expect(new URL(urls[1]).searchParams.get("pageToken")).toBe("p2");
  });

  it("treats a course with no coursework as empty, not as an error", async () => {
    const { fetchImpl } = pagingFetch([{}]);
    expect(await listCourseWork("token", "c1", { fetchImpl, endpoint: ENDPOINT })).toEqual([]);
  });

  it("gives up rather than looping forever on a page token that never clears", async () => {
    const { fetchImpl } = pagingFetch([{ courseWork: [{ id: "cw-1", title: "One" }], nextPageToken: "always" }]);
    await expect(listCourseWork("token", "c1", { fetchImpl, endpoint: ENDPOINT })).rejects.toBeInstanceOf(ClassroomError);
  });

  it("skips deleted and draft coursework — neither is work the student can do", async () => {
    const { fetchImpl } = pagingFetch([
      {
        courseWork: [
          { id: "cw-1", title: "Live", state: "PUBLISHED" },
          { id: "cw-2", title: "Deleted", state: "DELETED" },
          { id: "cw-3", title: "Draft", state: "DRAFT" },
        ],
      },
    ]);
    const items = await listCourseWork("token", "c1", { fetchImpl, endpoint: ENDPOINT });
    expect(items.map((i) => i.title)).toEqual(["Live"]);
  });

  it("skips coursework with no id or no title rather than importing a placeholder", async () => {
    const { fetchImpl } = pagingFetch([
      { courseWork: [{ id: "cw-1", title: "Real", state: "PUBLISHED" }, { title: "No id" }, { id: "cw-3" }] },
    ]);
    expect(await listCourseWork("token", "c1", { fetchImpl, endpoint: ENDPOINT })).toHaveLength(1);
  });

  const errorCases: [number, string][] = [
    [401, "session-expired"],
    [403, "permission-denied"],
    [429, "rate-limited"],
    [503, "classroom-unavailable"],
  ];
  for (const [status, code] of errorCases) {
    it(`maps HTTP ${status} to "${code}"`, async () => {
      const failing = vi.fn(async () => new Response("{}", { status })) as unknown as typeof fetch;
      await expect(listCourseWork("token", "c1", { fetchImpl: failing, endpoint: ENDPOINT })).rejects.toMatchObject({ code });
    });
  }
});

describe("syncing several courses", () => {
  /**
   * Stands in for the whole chain: token refresh, then `courses.list`, then one `courseWork` call
   * per course, routed by URL.
   */
  function classroomFetch(coursework: Record<string, GoogleListCourseWorkResponse | { status: number }>) {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      calls.push(href);
      if (href.includes("oauth2.googleapis.com/token")) return jsonResponse({ access_token: "at", expires_in: 3599 });

      const match = /\/courses\/([^/]+)\/courseWork/.exec(href);
      if (match) {
        const entry = coursework[decodeURIComponent(match[1])] ?? {};
        if ("status" in entry) return new Response("{}", { status: entry.status });
        return jsonResponse(entry);
      }
      return jsonResponse({
        courses: [
          { id: "c1", name: "AP Biology", section: "Period 3", courseState: "ACTIVE" },
          { id: "c2", name: "Honors English", courseState: "ACTIVE" },
          { id: "c3", name: "Advisory", courseState: "ACTIVE" },
        ],
      });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it("fetches coursework for every selected course and tags it with the course name", async () => {
    const { fetchImpl } = classroomFetch({
      c1: { courseWork: [{ id: "cw-1", title: "Reading", state: "PUBLISHED" }] },
      c2: { courseWork: [{ id: "cw-2", title: "Essay", state: "PUBLISHED" }] },
    });

    const result = await fetchCourseWork(sealSession(SESSION, SESSION_SECRET), ["c1", "c2"], new Date(), fetchImpl);

    expect(result.courses.map((c) => c.courseName)).toEqual(["AP Biology", "Honors English"]);
    expect(result.courses[0].items[0].courseName).toBe("AP Biology");
    expect(result.courses[0].items[0].courseSection).toBe("Period 3");
  });

  it("skips courses the student excluded", async () => {
    const { fetchImpl, calls } = classroomFetch({ c1: { courseWork: [] } });
    await fetchCourseWork(sealSession(SESSION, SESSION_SECRET), ["c1"], new Date(), fetchImpl);
    expect(calls.some((c) => c.includes("/c3/courseWork"))).toBe(false);
  });

  it("treats an empty selection as every active course", async () => {
    const { fetchImpl, calls } = classroomFetch({});
    await fetchCourseWork(sealSession(SESSION, SESSION_SECRET), [], new Date(), fetchImpl);
    expect(calls.filter((c) => c.includes("/courseWork"))).toHaveLength(3);
  });

  it("keeps the courses that worked when one course fails", async () => {
    // Part 30: a single failing class must not cost the student the rest of their week.
    const { fetchImpl } = classroomFetch({
      c1: { courseWork: [{ id: "cw-1", title: "Reading", state: "PUBLISHED" }] },
      c2: { status: 404 },
    });

    const result = await fetchCourseWork(sealSession(SESSION, SESSION_SECRET), ["c1", "c2"], new Date(), fetchImpl);

    expect(result.courses[0].items).toHaveLength(1);
    expect(result.courses[1].failed).toBeDefined();
    expect(result.courses[1].items).toEqual([]);
  });

  it("says nothing about tokens or Google internals in a per-course failure message", async () => {
    const { fetchImpl } = classroomFetch({ c1: { status: 500 } });
    const result = await fetchCourseWork(sealSession(SESSION, SESSION_SECRET), ["c1"], new Date(), fetchImpl);
    expect(result.courses[0].failed!.message).not.toMatch(/ya29|refresh_token|classroom\.googleapis/);
  });

  it("fails the whole sync when the authorization itself is gone", async () => {
    // A revoked grant affects every course identically; reporting it once is the only useful thing.
    const { fetchImpl } = classroomFetch({ c1: { status: 401 }, c2: { status: 401 }, c3: { status: 401 } });
    await expect(fetchCourseWork(sealSession(SESSION, SESSION_SECRET), [], new Date(), fetchImpl)).rejects.toMatchObject({
      code: "session-expired",
    });
  });

  it("fetches the course list once, not once per assignment", async () => {
    const { fetchImpl, calls } = classroomFetch({
      c1: { courseWork: [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }] },
    });
    await fetchCourseWork(sealSession(SESSION, SESSION_SECRET), ["c1"], new Date(), fetchImpl);
    expect(calls.filter((c) => c.endsWith("courses?studentId=me&courseStates=ACTIVE&pageSize=100"))).toHaveLength(1);
  });

  it("returns every active course so the selection UI needs no extra round trip", async () => {
    const { fetchImpl } = classroomFetch({ c1: {} });
    const result = await fetchCourseWork(sealSession(SESSION, SESSION_SECRET), ["c1"], new Date(), fetchImpl);
    expect(result.allCourses.map((c) => c.name)).toEqual(["AP Biology", "Honors English", "Advisory"]);
  });

  it("refuses to call Google at all when nothing is connected", async () => {
    const shouldNotRun = vi.fn() as unknown as typeof fetch;
    await expect(fetchCourseWork(undefined, ["c1"], new Date(), shouldNotRun)).rejects.toMatchObject({ code: "not-connected" });
    expect(shouldNotRun).not.toHaveBeenCalled();
  });

  it("refuses to call Google when the deployment isn't configured", async () => {
    setEnv({});
    const shouldNotRun = vi.fn() as unknown as typeof fetch;
    await expect(fetchCourseWork("v1.anything", [], new Date(), shouldNotRun)).rejects.toMatchObject({ code: "not-configured" });
    expect(shouldNotRun).not.toHaveBeenCalled();
  });
});

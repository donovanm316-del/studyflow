import { describe, expect, it, vi } from "vitest";
import { listCourses } from "./client";
import { ClassroomError } from "./errors";
import type { GoogleListCoursesResponse } from "./types";

const ENDPOINT = "https://classroom.test/v1/courses";

/** Serves a scripted sequence of pages, recording every URL it was asked for. */
function pagingFetch(pages: GoogleListCoursesResponse[]) {
  let call = 0;
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL) => {
    urls.push(String(url));
    const body = pages[Math.min(call++, pages.length - 1)];
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

function failingFetch(status: number, body = "{}") {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe("listing courses", () => {
  it("returns normalized courses from a single page", async () => {
    const { fetchImpl } = pagingFetch([{ courses: [{ id: "1", name: "AP Biology", courseState: "ACTIVE" }] }]);
    const courses = await listCourses("token", { fetchImpl, endpoint: ENDPOINT });

    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({ provider: "google-classroom", externalCourseId: "1", name: "AP Biology" });
  });

  it("sends the access token as a bearer header, never in the URL", async () => {
    const { fetchImpl, urls } = pagingFetch([{ courses: [] }]);
    await listCourses("secret-token", { fetchImpl, endpoint: ENDPOINT });

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(urls[0]).not.toContain("secret-token");
  });

  it("asks only for classes the user is enrolled in as a student, and only active ones", async () => {
    // Without studentId=me, a user who also teaches would get their teaching load mixed into
    // their homework.
    const { fetchImpl, urls } = pagingFetch([{ courses: [] }]);
    await listCourses("token", { fetchImpl, endpoint: ENDPOINT });

    const params = new URL(urls[0]).searchParams;
    expect(params.get("studentId")).toBe("me");
    expect(params.get("courseStates")).toBe("ACTIVE");
  });

  it("follows pagination and accumulates every page", async () => {
    const { fetchImpl, urls } = pagingFetch([
      { courses: [{ id: "1", name: "Biology" }], nextPageToken: "page-2" },
      { courses: [{ id: "2", name: "Chemistry" }], nextPageToken: "page-3" },
      { courses: [{ id: "3", name: "History" }] },
    ]);

    const courses = await listCourses("token", { fetchImpl, endpoint: ENDPOINT });
    expect(courses.map((c) => c.name)).toEqual(["Biology", "Chemistry", "History"]);
    expect(urls).toHaveLength(3);
    expect(new URL(urls[1]).searchParams.get("pageToken")).toBe("page-2");
    expect(new URL(urls[2]).searchParams.get("pageToken")).toBe("page-3");
  });

  it("stops on the first page when there's no next page token", async () => {
    const { fetchImpl, urls } = pagingFetch([{ courses: [{ id: "1", name: "Biology" }] }]);
    await listCourses("token", { fetchImpl, endpoint: ENDPOINT });
    expect(urls).toHaveLength(1);
  });

  it("treats an empty page token as the end, not as a token to send", async () => {
    const { fetchImpl, urls } = pagingFetch([{ courses: [{ id: "1", name: "Biology" }], nextPageToken: "" }]);
    await listCourses("token", { fetchImpl, endpoint: ENDPOINT });
    expect(urls).toHaveLength(1);
  });

  it("gives up rather than looping forever on a token that never clears", async () => {
    // A serverless function would otherwise spin until it timed out.
    const { fetchImpl } = pagingFetch([{ courses: [{ id: "1", name: "Biology" }], nextPageToken: "always" }]);
    await expect(listCourses("token", { fetchImpl, endpoint: ENDPOINT })).rejects.toBeInstanceOf(ClassroomError);
  });

  it("returns an empty list for a student with no classes, rather than erroring", async () => {
    const { fetchImpl } = pagingFetch([{}]);
    expect(await listCourses("token", { fetchImpl, endpoint: ENDPOINT })).toEqual([]);
  });

  it("skips a malformed course without failing the whole request", async () => {
    const { fetchImpl } = pagingFetch([{ courses: [{ id: "1", name: "Biology" }, { name: "No id" }] }]);
    expect(await listCourses("token", { fetchImpl, endpoint: ENDPOINT })).toHaveLength(1);
  });
});

describe("error handling", () => {
  const cases: [number, string][] = [
    [401, "session-expired"],
    [403, "permission-denied"],
    [429, "rate-limited"],
    [500, "classroom-unavailable"],
    [503, "classroom-unavailable"],
  ];

  for (const [status, code] of cases) {
    it(`maps HTTP ${status} to "${code}"`, async () => {
      await expect(listCourses("token", { fetchImpl: failingFetch(status), endpoint: ENDPOINT })).rejects.toMatchObject({ code });
    });
  }

  it("maps an unreachable network to a network error", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(listCourses("token", { fetchImpl: failing, endpoint: ENDPOINT })).rejects.toMatchObject({ code: "network-error" });
  });

  it("rejects a 200 that isn't JSON instead of treating it as no courses", async () => {
    const html = vi.fn(async () => new Response("<html>proxy error</html>", { status: 200 })) as unknown as typeof fetch;
    await expect(listCourses("token", { fetchImpl: html, endpoint: ENDPOINT })).rejects.toBeInstanceOf(ClassroomError);
  });

  it("keeps Google's error body out of the message shown to the student", async () => {
    const leaky = failingFetch(403, JSON.stringify({ error: { message: "Request had insufficient authentication scopes for token ya29.LEAKED" } }));
    const error = (await listCourses("token", { fetchImpl: leaky, endpoint: ENDPOINT }).catch((e: unknown) => e)) as ClassroomError;

    expect(error.message).not.toContain("ya29.LEAKED");
    expect(error.message).toContain("permission");
  });
});

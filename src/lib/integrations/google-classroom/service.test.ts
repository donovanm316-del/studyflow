import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCourses, getConnectionStatus } from "./service";
import { sealSession, type ClassroomSession } from "./session";

const SESSION_SECRET = "a-test-session-secret-at-least-32-chars";

const CONFIGURED_ENV = {
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  GOOGLE_REDIRECT_URI: "https://studyflow.test/api/integrations/google-classroom/callback",
  STUDYFLOW_SESSION_SECRET: SESSION_SECRET,
};

const SESSION: ClassroomSession = {
  refreshToken: "1//refresh-token",
  grantedScopes: ["https://www.googleapis.com/auth/classroom.courses.readonly"],
  connectedAt: "2026-08-30T10:00:00.000Z",
};

const ORIGINAL_ENV = { ...process.env };

/** The service reads `process.env` directly, as it does in a route handler. */
function setEnv(vars: Record<string, string | undefined>) {
  for (const key of Object.keys(CONFIGURED_ENV)) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) if (value !== undefined) process.env[key] = value;
}

beforeEach(() => setEnv(CONFIGURED_ENV));
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("connection status", () => {
  it("reports connected, with the metadata the UI displays", () => {
    const status = getConnectionStatus(sealSession({ ...SESSION, lastCheckedAt: "2026-08-30T11:00:00.000Z", courseCount: 4 }, SESSION_SECRET));

    expect(status).toEqual({
      configured: true,
      missingConfig: [],
      connected: true,
      grantedScopes: SESSION.grantedScopes,
      connectedAt: "2026-08-30T10:00:00.000Z",
      lastCheckedAt: "2026-08-30T11:00:00.000Z",
      courseCount: 4,
    });
  });

  it("carries no token, secret, or client id in anything the browser receives", () => {
    // The status object is serialized straight to the client, so this is the last line of defense.
    const serialized = JSON.stringify(getConnectionStatus(sealSession(SESSION, SESSION_SECRET)));
    expect(serialized).not.toContain(SESSION.refreshToken);
    expect(serialized).not.toContain(SESSION_SECRET);
    expect(serialized).not.toContain("client-secret");
    expect(serialized).not.toContain("client-id");
  });

  it("reports not-connected when there's no cookie", () => {
    expect(getConnectionStatus(undefined)).toEqual({ configured: true, missingConfig: [], connected: false, grantedScopes: [] });
  });

  it("reports not-connected — never an error — for a tampered cookie", () => {
    expect(getConnectionStatus("v1.garbage").connected).toBe(false);
  });

  it("omits last-checked and course count until a check has genuinely run", () => {
    // Showing "0 classes" before any call would be a claim the app hasn't earned.
    const status = getConnectionStatus(sealSession(SESSION, SESSION_SECRET));
    expect(status.lastCheckedAt).toBeUndefined();
    expect(status.courseCount).toBeUndefined();
  });

  it("reports an unconfigured deployment honestly, listing the missing variable names", () => {
    setEnv({});
    const status = getConnectionStatus(undefined);
    expect(status.configured).toBe(false);
    expect(status.connected).toBe(false);
    expect(status.missingConfig).toContain("GOOGLE_CLIENT_ID");
  });

  it("reports partial configuration as unconfigured", () => {
    setEnv({ GOOGLE_CLIENT_ID: "client-id" });
    const status = getConnectionStatus(undefined);
    expect(status.configured).toBe(false);
    expect(status.missingConfig).toEqual(["GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "STUDYFLOW_SESSION_SECRET"]);
  });
});

describe("fetching courses", () => {
  function fetchStub(...responses: unknown[]) {
    let call = 0;
    return vi.fn(async () =>
      new Response(JSON.stringify(responses[Math.min(call++, responses.length - 1)]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ) as unknown as typeof fetch;
  }

  it("refreshes an access token, lists courses, and advances the check metadata", async () => {
    const result = await fetchCourses(
      sealSession(SESSION, SESSION_SECRET),
      new Date("2026-08-30T12:00:00.000Z"),
      fetchStub({ access_token: "at", scope: SESSION.grantedScopes[0], expires_in: 3599 }, { courses: [{ id: "1", name: "Biology" }] })
    );

    expect(result.courses.map((c) => c.name)).toEqual(["Biology"]);
    expect(result.session.lastCheckedAt).toBe("2026-08-30T12:00:00.000Z");
    expect(result.session.courseCount).toBe(1);
  });

  it("keeps the refresh token unchanged — nothing about the stored credential moves", () => {
    // The access token is minted and dropped; only the refresh token persists, untouched.
    return fetchCourses(
      sealSession(SESSION, SESSION_SECRET),
      new Date(),
      fetchStub({ access_token: "at" }, { courses: [] })
    ).then((result) => expect(result.session.refreshToken).toBe(SESSION.refreshToken));
  });

  it("records zero courses as zero rather than leaving the previous count in place", async () => {
    const stale = sealSession({ ...SESSION, courseCount: 5 }, SESSION_SECRET);
    const result = await fetchCourses(stale, new Date(), fetchStub({ access_token: "at" }, { courses: [] }));
    expect(result.session.courseCount).toBe(0);
  });

  it("adopts the scopes Google reports, so revoking one in the Google account self-corrects", async () => {
    const result = await fetchCourses(
      sealSession(SESSION, SESSION_SECRET),
      new Date(),
      fetchStub({ access_token: "at", scope: "https://www.googleapis.com/auth/classroom.courses.readonly extra" }, { courses: [] })
    );
    expect(result.session.grantedScopes).toEqual([
      "https://www.googleapis.com/auth/classroom.courses.readonly",
      "extra",
    ]);
  });

  it("refuses to call Google when nothing is connected", async () => {
    const shouldNotRun = vi.fn() as unknown as typeof fetch;
    await expect(fetchCourses(undefined, new Date(), shouldNotRun)).rejects.toMatchObject({ code: "not-connected" });
    expect(shouldNotRun).not.toHaveBeenCalled();
  });

  it("refuses to call Google when the deployment isn't configured", async () => {
    setEnv({});
    const shouldNotRun = vi.fn() as unknown as typeof fetch;
    await expect(fetchCourses("v1.anything", new Date(), shouldNotRun)).rejects.toMatchObject({ code: "not-configured" });
    expect(shouldNotRun).not.toHaveBeenCalled();
  });
});

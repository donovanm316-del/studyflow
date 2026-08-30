import { describe, expect, it, vi } from "vitest";
import { buildAuthorizationUrl, exchangeCodeForTokens, refreshAccessToken, revokeToken } from "./oauth";
import { ClassroomError } from "./errors";
import { CLASSROOM_COURSES_READONLY_SCOPE, type GoogleConfig } from "./config";

const CONFIG: GoogleConfig = {
  clientId: "test-client-id.apps.googleusercontent.com",
  clientSecret: "SUPER-SECRET-VALUE",
  redirectUri: "https://studyflow.test/api/integrations/google-classroom/callback",
  sessionSecret: "a-test-session-secret-at-least-32-chars",
};

/** A `fetch` stand-in returning a fixed response, with the calls it received recorded. */
function stubFetch(response: Response | (() => never)) {
  return vi.fn(async () => (typeof response === "function" ? response() : response.clone())) as unknown as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("authorization URL", () => {
  const url = new URL(buildAuthorizationUrl(CONFIG, "state-value"));

  it("points at Google's current authorization endpoint", () => {
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  });

  it("requests only the read-only courses scope", () => {
    expect(url.searchParams.get("scope")).toBe(CLASSROOM_COURSES_READONLY_SCOPE);
  });

  it("never puts the client secret in a URL the browser will hold", () => {
    // This string lands in the address bar, browser history, and any referrer header.
    expect(url.toString()).not.toContain(CONFIG.clientSecret);
    expect(url.searchParams.get("client_secret")).toBeNull();
  });

  it("asks for offline access with a forced consent, so a refresh token actually arrives", () => {
    // Without prompt=consent, a returning student gets only an access token and the connection
    // dies silently within the hour.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("enables incremental authorization so Phase 5B can add a scope without losing this grant", () => {
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
  });

  it("carries the CSRF state value and the exact registered redirect URI", () => {
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("redirect_uri")).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});

describe("authorization code exchange", () => {
  it("returns the grant on success", async () => {
    const grant = await exchangeCodeForTokens(
      CONFIG,
      "auth-code",
      stubFetch(json({ access_token: "at", refresh_token: "rt", scope: CLASSROOM_COURSES_READONLY_SCOPE, expires_in: 3599 }))
    );
    expect(grant).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      grantedScopes: [CLASSROOM_COURSES_READONLY_SCOPE],
      expiresInSeconds: 3599,
    });
  });

  it("sends the secret in the POST body, not the query string", async () => {
    const fetchImpl = stubFetch(json({ access_token: "at" }));
    await exchangeCodeForTokens(CONFIG, "auth-code", fetchImpl);

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(url).not.toContain(CONFIG.clientSecret);
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("client_secret=");
  });

  it("reads a revoked grant as an expired session, which is what the student sees", async () => {
    // Exactly what Google returns after someone removes StudyFlow at myaccount.google.com.
    await expect(refreshAccessToken(CONFIG, "rt", stubFetch(json({ error: "invalid_grant" }, 400)))).rejects.toMatchObject({
      code: "session-expired",
    });
  });

  it("reads a bad client id/secret as a StudyFlow configuration problem", async () => {
    await expect(exchangeCodeForTokens(CONFIG, "c", stubFetch(json({ error: "invalid_client" }, 401)))).rejects.toMatchObject({
      code: "invalid-credentials",
    });
  });

  it("reads a Google outage as unavailable rather than as the student's fault", async () => {
    await expect(exchangeCodeForTokens(CONFIG, "c", stubFetch(json({}, 503)))).rejects.toMatchObject({
      code: "classroom-unavailable",
    });
  });

  it("treats an unreachable network as a network error", async () => {
    const failing = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(exchangeCodeForTokens(CONFIG, "c", failing)).rejects.toMatchObject({ code: "network-error" });
  });

  it("rejects a 200 response that carries no access token", async () => {
    await expect(exchangeCodeForTokens(CONFIG, "c", stubFetch(json({ token_type: "Bearer" })))).rejects.toMatchObject({
      code: "oauth-failed",
    });
  });

  it("never surfaces Google's error body to the caller", async () => {
    // Google's token errors echo the request, including the redirect URI and client id.
    const leaky = json({ error: "invalid_request", error_description: `redirect_uri=${CONFIG.redirectUri} secret leaked` }, 400);
    const error = await exchangeCodeForTokens(CONFIG, "c", stubFetch(leaky)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ClassroomError);
    expect((error as ClassroomError).message).not.toContain("leaked");
    expect((error as ClassroomError).message).not.toContain(CONFIG.redirectUri);
  });
});

describe("token refresh", () => {
  it("uses the refresh_token grant and returns a fresh access token", async () => {
    const fetchImpl = stubFetch(json({ access_token: "fresh", scope: CLASSROOM_COURSES_READONLY_SCOPE, expires_in: 3599 }));
    const grant = await refreshAccessToken(CONFIG, "rt", fetchImpl);

    expect(grant.accessToken).toBe("fresh");
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain("grant_type=refresh_token");
  });
});

describe("revocation", () => {
  it("reports success when Google confirms", async () => {
    expect(await revokeToken("rt", stubFetch(new Response("", { status: 200 })))).toBe(true);
  });

  it("never throws, so disconnecting always completes for the student", async () => {
    // The cookie is cleared either way; an error here would leave them staring at a failure on a
    // button that did exactly what they asked.
    const failing = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(revokeToken("rt", failing)).resolves.toBe(false);
    await expect(revokeToken("rt", stubFetch(new Response("", { status: 400 })))).resolves.toBe(false);
  });
});

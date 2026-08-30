/**
 * Google's OAuth 2.0 authorization-code flow, as used by a server-rendered web app.
 *
 * SERVER ONLY — every function below either holds the client secret or handles a token.
 *
 *   /connect   → buildAuthorizationUrl()  → Google consent screen
 *   /callback  → exchangeCodeForTokens()  → sealed into the session cookie
 *   any call   → refreshAccessToken()     → short-lived access token, used and dropped
 *   /disconnect→ revokeToken()            → the grant is withdrawn at Google, not just forgotten
 *
 * The code never leaves the server, the secret is only ever sent in a POST body to Google's token
 * endpoint, and no function here returns a Google error body to its caller — failures are mapped to
 * `ClassroomError` codes first.
 */
import { ClassroomError } from "./errors";
import { REQUESTED_SCOPES, type GoogleConfig } from "./config";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** Injectable so tests can drive the flow without network access. */
export type FetchLike = typeof fetch;

export interface TokenGrant {
  accessToken: string;
  /** Present only on the first consent, or when `prompt=consent` forces a fresh one. */
  refreshToken?: string;
  grantedScopes: string[];
  expiresInSeconds: number;
}

/**
 * The URL to send the student to.
 *
 * `access_type=offline` with `prompt=consent` is what makes a refresh token arrive. Google returns
 * one only on a fresh consent, so a student who reconnects after a previous grant would otherwise
 * come back with an access token and nothing durable — the connection would appear to work and
 * then silently die within the hour. Forcing consent costs one extra click and removes that
 * failure mode entirely.
 *
 * `include_granted_scopes=true` enables incremental authorization, so Phase 5B can add the
 * coursework scope without discarding this grant.
 *
 * The client secret is not a parameter of this request and must never be added to it — this URL
 * ends up in the student's address bar and browser history.
 */
export function buildAuthorizationUrl(config: GoogleConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: REQUESTED_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Turns a Google token-endpoint failure into a code.
 *
 * `invalid_grant` is the one that matters operationally: it's what Google returns when a refresh
 * token has been revoked from the student's Google account settings, which is a completely normal
 * thing for a student to do and must read as "reconnect", not as a crash.
 */
function tokenErrorCode(status: number, body: string): ClassroomError {
  if (body.includes("invalid_client") || body.includes("unauthorized_client")) {
    return new ClassroomError("invalid-credentials", `token endpoint ${status}`);
  }
  if (body.includes("invalid_grant")) return new ClassroomError("session-expired", `token endpoint ${status}`);
  if (status >= 500) return new ClassroomError("classroom-unavailable", `token endpoint ${status}`);
  return new ClassroomError("oauth-failed", `token endpoint ${status}`);
}

async function postToken(params: URLSearchParams, fetchImpl: FetchLike): Promise<TokenGrant> {
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch {
    throw new ClassroomError("network-error", "token endpoint unreachable");
  }

  if (!response.ok) {
    // Read the body to classify the failure, then discard it. It is never returned to the browser:
    // Google's token errors echo the request, including the redirect URI and client id.
    const body = await response.text().catch(() => "");
    throw tokenErrorCode(response.status, body);
  }

  const json = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
  } | null;

  if (!json?.access_token) throw new ClassroomError("oauth-failed", "token response had no access_token");

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    grantedScopes: json.scope ? json.scope.split(" ").filter(Boolean) : [],
    expiresInSeconds: json.expires_in ?? 0,
  };
}

/** Exchanges the one-time authorization code from the callback for tokens. */
export function exchangeCodeForTokens(config: GoogleConfig, code: string, fetchImpl: FetchLike = fetch): Promise<TokenGrant> {
  return postToken(
    new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
    fetchImpl
  );
}

/** Mints a fresh access token. Called for every Classroom request; the result is never persisted. */
export function refreshAccessToken(config: GoogleConfig, refreshToken: string, fetchImpl: FetchLike = fetch): Promise<TokenGrant> {
  return postToken(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
    fetchImpl
  );
}

/**
 * Withdraws the grant at Google.
 *
 * Deliberately does not throw. Disconnecting must always succeed from the student's point of view:
 * the cookie is dropped either way, so StudyFlow's access ends regardless. Reporting a failure here
 * would leave them staring at an error on a button that did what they asked. The return value says
 * whether Google confirmed it, for the caller's logs.
 */
export async function revokeToken(token: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return response.ok;
  } catch {
    return false;
  }
}

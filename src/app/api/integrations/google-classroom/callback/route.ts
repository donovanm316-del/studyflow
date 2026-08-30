/**
 * GET — where Google sends the student back after the consent screen.
 *
 * This URL must be registered verbatim as an authorized redirect URI in the Google Cloud console
 * (see docs/google-classroom-setup.md); Google compares it character for character.
 *
 * Every exit path from this handler is a redirect back to Settings carrying a result the page can
 * render. Nothing here returns JSON or an error page — the student arrived by clicking a button on
 * Settings, and that is where they should land.
 */
import { type NextRequest } from "next/server";
import { readGoogleConfig } from "@/lib/integrations/google-classroom/config";
import { toClassroomErrorCode } from "@/lib/integrations/google-classroom/errors";
import { exchangeCodeForTokens } from "@/lib/integrations/google-classroom/oauth";
import {
  cookieOptions,
  OAUTH_STATE_COOKIE,
  sealSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/integrations/google-classroom/session";
import { isSecureRequest, settingsRedirect } from "../shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const secure = isSecureRequest(request);

  const configResult = readGoogleConfig();
  if (!configResult.ok) return settingsRedirect(request, { classroom: "error", reason: "not-configured" });

  // Google reports a declined consent as ?error=access_denied. That's a choice the student made,
  // not a malfunction, and it gets its own message.
  const googleError = params.get("error");
  if (googleError) {
    return settingsRedirect(request, {
      classroom: "error",
      reason: googleError === "access_denied" ? "oauth-denied" : "oauth-failed",
    });
  }

  // CSRF check. Both halves must be present and equal; a callback that arrives without the cookie
  // this browser was issued at /connect is rejected outright.
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const state = params.get("state");
  const code = params.get("code");
  if (!expectedState || !state || state !== expectedState || !code) {
    const rejected = settingsRedirect(request, { classroom: "error", reason: "oauth-failed" });
    rejected.cookies.set(OAUTH_STATE_COOKIE, "", cookieOptions(0, secure));
    return rejected;
  }

  try {
    const grant = await exchangeCodeForTokens(configResult.config, code);

    // `prompt=consent` on the authorization request means Google should always return a refresh
    // token here. If one is somehow absent, the connection would work for an hour and then quietly
    // stop, so it's treated as a failed connection rather than stored as a half-working one.
    if (!grant.refreshToken) {
      const noRefresh = settingsRedirect(request, { classroom: "error", reason: "oauth-failed" });
      noRefresh.cookies.set(OAUTH_STATE_COOKIE, "", cookieOptions(0, secure));
      return noRefresh;
    }

    const response = settingsRedirect(request, { classroom: "connected" });
    response.cookies.set(
      SESSION_COOKIE,
      sealSession(
        {
          refreshToken: grant.refreshToken,
          grantedScopes: grant.grantedScopes,
          connectedAt: new Date().toISOString(),
        },
        configResult.config.sessionSecret
      ),
      cookieOptions(SESSION_MAX_AGE_SECONDS, secure)
    );
    // The state value is single-use; it goes as soon as it has done its job.
    response.cookies.set(OAUTH_STATE_COOKIE, "", cookieOptions(0, secure));
    return response;
  } catch (error) {
    const failed = settingsRedirect(request, { classroom: "error", reason: toClassroomErrorCode(error) });
    failed.cookies.set(OAUTH_STATE_COOKIE, "", cookieOptions(0, secure));
    return failed;
  }
}

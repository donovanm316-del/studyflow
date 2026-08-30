/**
 * GET — starts the OAuth flow by redirecting to Google's consent screen.
 *
 * This is a top-level navigation rather than a fetch, because the student has to actually see and
 * interact with Google's own consent UI. StudyFlow never renders a Google password prompt and never
 * sees the credentials.
 */
import { NextResponse, type NextRequest } from "next/server";
import { readGoogleConfig } from "@/lib/integrations/google-classroom/config";
import { buildAuthorizationUrl } from "@/lib/integrations/google-classroom/oauth";
import { createOAuthState, cookieOptions, OAUTH_STATE_COOKIE, OAUTH_STATE_MAX_AGE_SECONDS } from "@/lib/integrations/google-classroom/session";
import { isSecureRequest, settingsRedirect } from "../shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const configResult = readGoogleConfig();
  if (!configResult.ok) {
    // No credentials, so there is nowhere to redirect to. Back to Settings with an honest reason
    // rather than a broken Google page.
    return settingsRedirect(request, { classroom: "error", reason: "not-configured" });
  }

  // The CSRF defense: a random value goes out in the authorization URL and simultaneously into an
  // httpOnly cookie. The callback only proceeds when the two match, so a forged callback — someone
  // linking a victim's StudyFlow to an attacker's Google account — has no way to produce a request
  // that passes, since it cannot set this cookie.
  const state = createOAuthState();
  const response = NextResponse.redirect(buildAuthorizationUrl(configResult.config, state));
  response.cookies.set(OAUTH_STATE_COOKIE, state, cookieOptions(OAUTH_STATE_MAX_AGE_SECONDS, isSecureRequest(request)));
  return response;
}

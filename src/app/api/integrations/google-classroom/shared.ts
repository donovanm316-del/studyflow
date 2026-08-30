/**
 * Bits shared by the Google Classroom route handlers.
 *
 * Kept out of the route files themselves so that the rule "a failure response carries a code and a
 * vetted message, never a Google error body" is written once and reused, rather than re-derived in
 * five `catch` blocks.
 */
import { NextResponse } from "next/server";
import { classroomErrorMessage, toClassroomErrorCode } from "@/lib/integrations/google-classroom/errors";
import type { ClassroomErrorCode } from "@/lib/integrations/google-classroom/errors";

/**
 * Whether cookies should carry the `Secure` flag.
 *
 * Local development over plain HTTP is the only exception: browsers refuse to store `Secure`
 * cookies on an insecure origin, so the connection would silently fail to persist. Every deployed
 * origin is HTTPS and gets the flag.
 */
export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

/** HTTP status for a failure code. */
function statusFor(code: ClassroomErrorCode): number {
  switch (code) {
    case "not-configured":
    case "invalid-credentials":
      return 503; // the deployment is misconfigured; nothing the caller sent is wrong
    case "not-connected":
    case "session-expired":
      return 401;
    case "permission-denied":
      return 403;
    case "rate-limited":
      return 429;
    case "classroom-unavailable":
    case "network-error":
      return 502;
    default:
      return 500;
  }
}

/**
 * The only way a route reports a failure.
 *
 * The body carries the code and the fixed student-facing sentence for it — never the thrown
 * error's own message, never a stack trace, never anything Google sent back. `error.detail` is
 * intentionally dropped here; it exists for server-side logging, where it stays.
 */
export function errorResponse(error: unknown): NextResponse {
  const code = toClassroomErrorCode(error);
  return NextResponse.json({ error: code, message: classroomErrorMessage(code) }, { status: statusFor(code) });
}

/** Sends the student back to Settings with a result the page can render. */
export function settingsRedirect(request: Request, params: Record<string, string>): NextResponse {
  const url = new URL("/settings", request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

/**
 * GET — the student's Google Classroom classes, and the "Check connection" action.
 *
 * These are the same operation: the only honest way to report that a connection works is to make a
 * real call with it. There is no separate ping that could succeed while the actual integration is
 * broken.
 *
 * Read-only. Phase 5A retrieves classes and nothing more — no coursework is fetched, no work item
 * is created, and nothing is written back to Classroom.
 */
import { NextResponse, type NextRequest } from "next/server";
import { fetchCourses } from "@/lib/integrations/google-classroom/service";
import { cookieOptions, sealSession, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/integrations/google-classroom/session";
import { readGoogleConfig } from "@/lib/integrations/google-classroom/config";
import { errorResponse, isSecureRequest } from "../shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const result = await fetchCourses(request.cookies.get(SESSION_COOKIE)?.value);

    const response = NextResponse.json(
      { courses: result.courses, lastCheckedAt: result.session.lastCheckedAt, courseCount: result.courses.length },
      { headers: { "Cache-Control": "no-store" } }
    );

    // Re-seal so "last checked" and the course count survive the request. `fetchCourses` already
    // proved the config is readable, so this branch is a type narrowing rather than a real check.
    const configResult = readGoogleConfig();
    if (configResult.ok) {
      response.cookies.set(
        SESSION_COOKIE,
        sealSession(result.session, configResult.config.sessionSecret),
        cookieOptions(SESSION_MAX_AGE_SECONDS, isSecureRequest(request))
      );
    }

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

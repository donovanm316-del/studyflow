/**
 * GET — coursework for the courses the student chose to sync.
 *
 * Read-only. This route fetches; it decides nothing. Reconciliation (what's new, what changed, what
 * would be a duplicate) happens client-side in `classroom-sync.ts` against the student's local
 * data, which never leaves the browser — the server has no copy of their planner to compare
 * against, and shouldn't.
 *
 * Course selection arrives as repeated `courseId` parameters. Omitting them means "every active
 * course", which is the state a student is in before they've narrowed anything down.
 */
import { NextResponse, type NextRequest } from "next/server";
import { fetchCourseWork } from "@/lib/integrations/google-classroom/service";
import { readGoogleConfig } from "@/lib/integrations/google-classroom/config";
import { cookieOptions, sealSession, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/integrations/google-classroom/session";
import { errorResponse, isSecureRequest } from "../shared";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const courseIds = new URL(request.url).searchParams.getAll("courseId").filter(Boolean);
    const result = await fetchCourseWork(request.cookies.get(SESSION_COOKIE)?.value, courseIds);

    const response = NextResponse.json(
      {
        courses: result.courses,
        allCourses: result.allCourses,
        lastCheckedAt: result.session.lastCheckedAt,
        // Counted here rather than in the browser so the two can't disagree about what arrived.
        itemCount: result.courses.reduce((total, course) => total + course.items.length, 0),
        failedCourses: result.courses.filter((c) => c.failed).map((c) => ({ courseName: c.courseName, message: c.failed!.message })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );

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

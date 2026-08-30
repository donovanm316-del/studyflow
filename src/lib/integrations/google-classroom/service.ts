/**
 * The application-level Google Classroom service.
 *
 * SERVER ONLY.
 *
 * This is the layer the API routes talk to, and the reason no React component anywhere in
 * StudyFlow contains a Google URL, a scope string, or a token:
 *
 *   React component → fetch("/api/integrations/google-classroom/…") → route → this service
 *                   → oauth.ts / client.ts → Google
 *
 * Routes stay thin — read cookie, call a function here, write cookie, return JSON — so the rules
 * about what may cross the network boundary live in one place instead of five.
 */
import { readGoogleConfig } from "./config";
import { ClassroomError, classroomErrorMessage, toClassroomErrorCode } from "./errors";
import { listCourses, listCourseWork } from "./client";
import { refreshAccessToken, type FetchLike } from "./oauth";
import { openSession, type ClassroomSession } from "./session";
import type { ClassroomConnectionStatus, CourseWorkFetchResult, ExternalCourse } from "./types";

/**
 * Everything the Settings page is allowed to know.
 *
 * Note what cannot appear in the return value: no token, no client id, no refresh token, no secret.
 * The type itself enforces it — `ClassroomConnectionStatus` has no field capable of carrying one.
 *
 * There is also no account name or email here, deliberately. Learning who the student is signed in
 * as would require an identity scope (`openid`/`email`) or `classroom.profile.emails`, and none of
 * those is needed to list classes. Requesting a permission purely so the UI can print an address
 * is not a trade worth making, so the UI says "connected" and doesn't claim to know more.
 */
export function getConnectionStatus(sealedCookie: string | undefined): ClassroomConnectionStatus {
  const configResult = readGoogleConfig();
  if (!configResult.ok) {
    // Without the session secret the cookie cannot be opened at all, so an unconfigured deployment
    // reports "not connected" — which is the truth: nothing here can reach Google.
    return { configured: false, missingConfig: configResult.missing, connected: false, grantedScopes: [] };
  }

  const session = openSession(sealedCookie, configResult.config.sessionSecret);
  if (!session) return { configured: true, missingConfig: [], connected: false, grantedScopes: [] };

  return {
    configured: true,
    missingConfig: [],
    connected: true,
    grantedScopes: session.grantedScopes,
    connectedAt: session.connectedAt,
    lastCheckedAt: session.lastCheckedAt,
    courseCount: session.courseCount,
  };
}

/** Opens the session or explains precisely why it couldn't be opened. */
export function requireSession(sealedCookie: string | undefined): { session: ClassroomSession; sessionSecret: string } {
  const configResult = readGoogleConfig();
  if (!configResult.ok) throw new ClassroomError("not-configured", `missing: ${configResult.missing.join(", ")}`);

  const session = openSession(sealedCookie, configResult.config.sessionSecret);
  if (!session) throw new ClassroomError("not-connected");

  return { session, sessionSecret: configResult.config.sessionSecret };
}

export interface CoursesResult {
  courses: ExternalCourse[];
  /** The session with `lastCheckedAt`/`courseCount` advanced, for the route to re-seal. */
  session: ClassroomSession;
}

/**
 * Fetches the student's classes — the one real proof that the whole chain works.
 *
 * A fresh access token is minted per call rather than cached, because the only thing StudyFlow
 * persists is the refresh token (see `session.ts`). At the volume of requests this feature makes —
 * a student pressing "Check connection" — the extra round trip is invisible, and it removes an
 * entire class of stale-token bugs.
 */
export async function fetchCourses(
  sealedCookie: string | undefined,
  now: Date = new Date(),
  fetchImpl: FetchLike = fetch
): Promise<CoursesResult> {
  const configResult = readGoogleConfig();
  if (!configResult.ok) throw new ClassroomError("not-configured", `missing: ${configResult.missing.join(", ")}`);

  const session = openSession(sealedCookie, configResult.config.sessionSecret);
  if (!session) throw new ClassroomError("not-connected");

  const grant = await refreshAccessToken(configResult.config, session.refreshToken, fetchImpl);
  const courses = await listCourses(grant.accessToken, { fetchImpl });

  return {
    courses,
    session: {
      ...session,
      // Google reports granted scopes on refresh too, so this self-corrects if the student edits
      // StudyFlow's access in their Google account without disconnecting here.
      grantedScopes: grant.grantedScopes.length > 0 ? grant.grantedScopes : session.grantedScopes,
      lastCheckedAt: now.toISOString(),
      courseCount: courses.length,
    },
  };
}

export interface CourseWorkResult {
  /** One entry per requested course, in the order the courses came back from Google. */
  courses: CourseWorkFetchResult[];
  /**
   * Every active course, including ones the student excluded from syncing.
   *
   * Returned alongside the coursework so the course-selection UI doesn't need a second round trip
   * to Google to render its checkboxes (Part 37) — the list was fetched anyway to resolve names.
   */
  allCourses: ExternalCourse[];
  session: ClassroomSession;
}

/**
 * Fetches coursework for the courses the student chose to sync.
 *
 * Two decisions worth naming:
 *
 * **Partial failure doesn't discard success.** Each course is fetched independently and a failure
 * is recorded against that course alone (Part 30). One class with a permissions quirk should not
 * cost the student the other five classes' assignments — they get what could be retrieved, plus an
 * honest note about what couldn't.
 *
 * **The course list is fetched once.** Names and sections come from that single call and are joined
 * onto each item here, rather than re-requesting a course per assignment (Part 37).
 *
 * A `session-expired` or `permission-denied` failure is different in kind: it will affect every
 * course identically, so it propagates instead of being reported thirty times over.
 */
export async function fetchCourseWork(
  sealedCookie: string | undefined,
  selectedCourseIds: string[],
  now: Date = new Date(),
  fetchImpl: FetchLike = fetch
): Promise<CourseWorkResult> {
  const configResult = readGoogleConfig();
  if (!configResult.ok) throw new ClassroomError("not-configured", `missing: ${configResult.missing.join(", ")}`);

  const session = openSession(sealedCookie, configResult.config.sessionSecret);
  if (!session) throw new ClassroomError("not-connected");

  const grant = await refreshAccessToken(configResult.config, session.refreshToken, fetchImpl);
  const allCourses = await listCourses(grant.accessToken, { fetchImpl });

  // An empty selection means "every active course" — the state a student is in before they've
  // narrowed anything down. Selecting nothing deliberately isn't expressible, and shouldn't be:
  // that's what not syncing is for.
  const wanted =
    selectedCourseIds.length > 0
      ? allCourses.filter((c) => selectedCourseIds.includes(c.externalCourseId))
      : allCourses;

  const results: CourseWorkFetchResult[] = [];
  for (const course of wanted) {
    try {
      const items = await listCourseWork(grant.accessToken, course.externalCourseId, {
        fetchImpl,
        course: { name: course.name, section: course.section },
      });
      results.push({ externalCourseId: course.externalCourseId, courseName: course.name, items });
    } catch (error) {
      const code = toClassroomErrorCode(error);
      // A revoked or expired authorization is not a per-course problem; failing the whole sync is
      // both truthful and the only thing the student can act on.
      if (code === "session-expired" || code === "permission-denied" || code === "not-connected") throw error;
      results.push({
        externalCourseId: course.externalCourseId,
        courseName: course.name,
        items: [],
        failed: { code, message: classroomErrorMessage(code) },
      });
    }
  }

  return {
    courses: results,
    allCourses,
    session: {
      ...session,
      grantedScopes: grant.grantedScopes.length > 0 ? grant.grantedScopes : session.grantedScopes,
      lastCheckedAt: now.toISOString(),
      courseCount: allCourses.length,
    },
  };
}

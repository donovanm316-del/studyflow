/**
 * The Google Classroom REST client.
 *
 * SERVER ONLY — it takes a bearer token.
 *
 * Scope note: this is a client for the two or three calls StudyFlow actually makes, not a general
 * Google API abstraction. Every method here is read-only by construction; there is no code path in
 * StudyFlow that issues a POST, PATCH, or DELETE to Classroom, so no Classroom coursework can be
 * created, modified, submitted, or deleted by this app.
 */
import { ClassroomError, codeForHttpStatus } from "./errors";
import { normalizeCourses } from "./normalize";
import type { FetchLike } from "./oauth";
import type { ExternalCourse, GoogleListCoursesResponse } from "./types";

const COURSES_ENDPOINT = "https://classroom.googleapis.com/v1/courses";

/** Google's maximum for this endpoint. Fewer round trips for the same result. */
const PAGE_SIZE = 100;

/**
 * A stop on pagination. A student has tens of classes, not thousands, so hitting this means Google
 * is returning a `nextPageToken` that never clears — a loop that would otherwise run forever inside
 * a serverless function until it timed out.
 */
const MAX_PAGES = 20;

export interface ListCoursesOptions {
  fetchImpl?: FetchLike;
  /** Overridable so tests don't need a live endpoint. */
  endpoint?: string;
}

async function getJson<T>(url: string, accessToken: string, fetchImpl: FetchLike): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
  } catch {
    throw new ClassroomError("network-error", "classroom endpoint unreachable");
  }

  if (!response.ok) {
    // The status is enough to classify the failure. Google's error bodies quote the request URL —
    // which carries query parameters — so the body is read for the server-side detail string only
    // and never travels back to the browser.
    const detail = await response.text().catch(() => "");
    throw new ClassroomError(codeForHttpStatus(response.status), `classroom ${response.status}: ${detail.slice(0, 200)}`);
  }

  const json = (await response.json().catch(() => null)) as T | null;
  if (json === null) throw new ClassroomError("unknown", "classroom response was not JSON");
  return json;
}

/**
 * Every active class the student is enrolled in.
 *
 * `studentId=me` restricts results to enrollments, which is the right filter for a student planner:
 * without it, a user who also teaches a class would get their teaching load mixed into their
 * homework. `courseStates=ACTIVE` leaves out archived classes from previous terms.
 *
 * An empty list is returned as an empty list, not as an error — whether "no classes" is worth
 * telling the student about is a UI decision, made in the route.
 */
export async function listCourses(accessToken: string, options: ListCoursesOptions = {}): Promise<ExternalCourse[]> {
  const { fetchImpl = fetch, endpoint = COURSES_ENDPOINT } = options;

  const courses: ExternalCourse[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ studentId: "me", courseStates: "ACTIVE", pageSize: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);

    const body = await getJson<GoogleListCoursesResponse>(`${endpoint}?${params.toString()}`, accessToken, fetchImpl);
    courses.push(...normalizeCourses(body.courses ?? []));

    pageToken = body.nextPageToken || undefined;
    if (!pageToken) return courses;
  }

  throw new ClassroomError("unknown", `classroom pagination exceeded ${MAX_PAGES} pages`);
}

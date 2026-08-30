/**
 * Wire types for the Google Classroom API, and the normalized shapes StudyFlow uses instead.
 *
 * The split matters: everything below the `Google*` prefix is Google's response shape and must not
 * travel past `normalize.ts`. Nothing in the scheduling engine, the store, or the UI is allowed to
 * see a `GoogleCourse` — they see `ExternalCourse`, which StudyFlow controls and can keep stable
 * if Google changes theirs.
 *
 * Fields are declared optional wherever Google declares them optional. Protobuf JSON omits
 * default/zero values entirely, so "the field is missing" is the normal case, not an error case,
 * and pretending otherwise is how fabricated data gets in.
 */

// ---------------------------------------------------------------------------
// Google wire shapes (do not use outside this directory)
// ---------------------------------------------------------------------------

/** https://developers.google.com/workspace/classroom/reference/rest/v1/courses */
export interface GoogleCourse {
  id?: string;
  name?: string;
  section?: string;
  descriptionHeading?: string;
  description?: string;
  room?: string;
  courseState?: string;
  alternateLink?: string;
  enrollmentCode?: string;
}

export interface GoogleListCoursesResponse {
  courses?: GoogleCourse[];
  nextPageToken?: string;
}

/** `google.type.Date` — a calendar date with no time zone and no instant attached. */
export interface GoogleDate {
  year?: number;
  month?: number;
  day?: number;
}

/** `google.type.TimeOfDay`. Classroom documents this as UTC. */
export interface GoogleTimeOfDay {
  hours?: number;
  minutes?: number;
  seconds?: number;
  nanos?: number;
}

/** https://developers.google.com/workspace/classroom/reference/rest/v1/courses.courseWork */
export interface GoogleCourseWork {
  id?: string;
  courseId?: string;
  title?: string;
  description?: string;
  state?: string;
  alternateLink?: string;
  workType?: string;
  /** Present only when Classroom carries a due date; UTC. */
  dueDate?: GoogleDate;
  /** Present only when Classroom carries a due time; UTC. See `normalize.ts` for the zero-value trap. */
  dueTime?: GoogleTimeOfDay;
  creationTime?: string;
  updateTime?: string;
}

export interface GoogleListCourseWorkResponse {
  courseWork?: GoogleCourseWork[];
  nextPageToken?: string;
}

// ---------------------------------------------------------------------------
// StudyFlow-side normalized shapes
// ---------------------------------------------------------------------------

/** The only provider StudyFlow knows about today. Widening this is a deliberate act, not a default. */
export const CLASSROOM_PROVIDER = "google-classroom" as const;

/**
 * Classroom's own lifecycle states, passed through rather than collapsed — an archived class
 * should not be silently treated as an active one.
 */
export type ExternalCourseState = "active" | "archived" | "provisioned" | "declined" | "unknown";

/**
 * A Google Classroom course as StudyFlow sees it.
 *
 * `externalCourseId` is kept because Phase 5B's synchronization needs it to fetch coursework and to
 * recognize a class it has already seen. It is deliberately *not* mapped onto StudyFlow's own
 * `subject` concept here — that mapping is a student-facing decision, not a transport concern.
 */
export interface ExternalCourse {
  provider: typeof CLASSROOM_PROVIDER;
  externalCourseId: string;
  name: string;
  section?: string;
  description?: string;
  state: ExternalCourseState;
  /** Link to the class in the Classroom web UI, when Google supplies one. */
  url?: string;
}

/**
 * One course's worth of retrieval, kept per course so a single failing class doesn't discard the
 * classes that succeeded (Part 30).
 */
export interface CourseWorkFetchResult {
  externalCourseId: string;
  courseName: string;
  /** Empty when the course genuinely has no coursework — distinct from `failed`. */
  items: import("@/lib/data/import").ExternalWorkItem[];
  /** Set only when this course's request failed; the others in the batch are still returned. */
  failed?: { code: string; message: string };
}

/** What the Settings UI is told about the connection. Contains no tokens, by construction. */
export interface ClassroomConnectionStatus {
  /** False when the deployment has no Google credentials — the honest "not set up" state. */
  configured: boolean;
  /** Which environment variables are missing. Names only; never values. */
  missingConfig: string[];
  connected: boolean;
  /** Scopes Google actually granted, as reported by the token response. */
  grantedScopes: string[];
  connectedAt?: string;
  lastCheckedAt?: string;
  /**
   * Course count from the last successful check. Absent until a check has actually run — this is
   * never estimated, defaulted to zero, or carried over from a failed request.
   */
  courseCount?: number;
}

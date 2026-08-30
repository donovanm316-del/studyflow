/**
 * Public surface of the Google Classroom integration — the *client-safe* half only.
 *
 * This barrel deliberately re-exports nothing from `config.ts`, `session.ts`, `oauth.ts`,
 * `client.ts`, or `service.ts`. Those modules read the OAuth client secret, the session key, and
 * bearer tokens; a barrel that pulled them in would let one careless `import { … } from
 * "@/lib/integrations/google-classroom"` in a React component drag a credential into the browser
 * bundle. API route handlers import those files by path, on purpose, so that reaching for a
 * server-only module is always a visible act.
 *
 * Types and copy are safe to share: they contain no secrets and the UI genuinely needs them.
 */
export {
  CLASSROOM_PROVIDER,
  type ClassroomConnectionStatus,
  type ExternalCourse,
  type ExternalCourseState,
} from "./types";

export { classroomErrorMessage, type ClassroomErrorCode } from "./errors";

export {
  normalizeClassroomDeadline,
  normalizeCourse,
  normalizeCourses,
  normalizeCourseWork,
  type ClassroomDeadline,
} from "./normalize";

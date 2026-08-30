/**
 * The complete set of ways connecting to Google Classroom can fail, and what the student is told
 * about each one.
 *
 * Two rules drive this file:
 *
 *  1. **Nothing from Google reaches the student.** Google's error bodies quote request URLs, echo
 *     scopes, and occasionally include token fragments. Every failure is therefore mapped to one of
 *     the codes below *before* it can leave the server, and the student sees only the fixed copy
 *     here. `unknown` exists precisely so that an unrecognized failure degrades to safe text rather
 *     than leaking whatever Google said.
 *  2. **Every code has an action.** A message that only says something broke leaves the student
 *     stuck, so each one names what to do next — or says plainly that the fix is the developer's.
 */

export type ClassroomErrorCode =
  /** The deployment has no Google credentials. A developer problem, not a student one. */
  | "not-configured"
  /** The student pressed "Cancel" on Google's consent screen. */
  | "oauth-denied"
  /** Google returned an error from the authorization redirect, or the state check failed. */
  | "oauth-failed"
  /** Google rejected the configured client id/secret. */
  | "invalid-credentials"
  /** The stored authorization no longer works — revoked in the Google account, or expired. */
  | "session-expired"
  /** No connection exists yet. */
  | "not-connected"
  /** Connected, but the granted scopes don't cover what was asked for. */
  | "permission-denied"
  /** Google's side is down or erroring. */
  | "classroom-unavailable"
  /** Too many requests. */
  | "rate-limited"
  /** The request never reached Google. */
  | "network-error"
  /** The call succeeded and the student genuinely has no classes. Not an error in Google's eyes. */
  | "no-courses"
  | "unknown";

const MESSAGES: Record<ClassroomErrorCode, string> = {
  "not-configured":
    "Google Classroom isn't set up for this copy of StudyFlow yet. It needs Google credentials to be configured before it can connect.",
  "oauth-denied": "You cancelled the Google sign-in, so nothing was connected. You can try again whenever you like.",
  "oauth-failed": "Google couldn't complete the sign-in. Try connecting again.",
  "invalid-credentials":
    "Google rejected this copy of StudyFlow's credentials. That's a setup problem on StudyFlow's side, not something you can fix.",
  "session-expired":
    "Your Google authorization has expired or was removed from your Google account. Connect again to restore access.",
  "not-connected": "Google Classroom isn't connected yet.",
  "permission-denied":
    "Google didn't grant StudyFlow permission to view your classes. Connect again and allow the requested access.",
  "classroom-unavailable": "Google Classroom isn't responding right now. This is usually temporary — try again shortly.",
  "rate-limited": "Google is temporarily limiting requests from StudyFlow. Wait a minute and try again.",
  "network-error": "StudyFlow couldn't reach Google. Check your connection and try again.",
  "no-courses":
    "No Google Classroom classes were found for your account. StudyFlow looks for classes you're enrolled in as a student.",
  unknown: "Something went wrong talking to Google Classroom. Try again, and reconnect if it keeps happening.",
};

/** The student-facing sentence for a failure. Total over the union, so there is no fallback path. */
export function classroomErrorMessage(code: ClassroomErrorCode): string {
  return MESSAGES[code];
}

/**
 * A failure that is safe to serialize to the browser: it carries a code and nothing else.
 *
 * The underlying detail is kept on `detail` for server logs and is deliberately not part of the
 * JSON the API routes return.
 */
export class ClassroomError extends Error {
  readonly code: ClassroomErrorCode;
  readonly detail?: string;

  constructor(code: ClassroomErrorCode, detail?: string) {
    super(classroomErrorMessage(code));
    this.name = "ClassroomError";
    this.code = code;
    this.detail = detail;
  }
}

/** Narrows an unknown thrown value to a code, so no `catch` block ever re-throws raw Google output. */
export function toClassroomErrorCode(error: unknown): ClassroomErrorCode {
  if (error instanceof ClassroomError) return error.code;
  // `fetch` rejects with a TypeError when the request never left the machine.
  if (error instanceof TypeError) return "network-error";
  return "unknown";
}

/**
 * Maps an HTTP status from Google onto a code.
 *
 * 403 is the interesting one: Classroom uses it both for "you didn't grant this scope" and for
 * "this project can't call the API at all". They're indistinguishable from the status alone, and
 * the scope case is overwhelmingly the one a student can act on, so it wins.
 */
export function codeForHttpStatus(status: number): ClassroomErrorCode {
  if (status === 401) return "session-expired";
  if (status === 403) return "permission-denied";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "classroom-unavailable";
  return "unknown";
}

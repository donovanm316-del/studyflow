/**
 * Server-side configuration for the Google Classroom connection.
 *
 * SERVER ONLY. Nothing in this file may be imported from a client component — it reads the OAuth
 * client secret and the session encryption key. The guard in `readGoogleConfig` turns that rule
 * from a convention into a runtime failure, because a bundling mistake here leaks a credential to
 * every visitor and would otherwise be invisible.
 *
 * Note the deliberate absence of `NEXT_PUBLIC_` anywhere below. Next.js inlines any variable with
 * that prefix into the client bundle, so a secret named that way is a published secret.
 */

/**
 * The scopes StudyFlow requests, and why each one is here.
 *
 * Both are read-only, and both are used by code that exists. Phase 5A requested only the first,
 * because that phase read only the class list; Phase 5B reads coursework, so it adds the second and
 * nothing else. The rule has not changed — the app holds no permission no code uses.
 *
 * `include_granted_scopes=true` on the authorization request is Google's incremental authorization
 * mechanism, so a student connected under Phase 5A is asked for the coursework permission alone
 * rather than re-consenting to everything.
 *
 * Explicitly rejected for this app:
 *  - `classroom.courses` and `classroom.coursework.me` (the non-`.readonly` forms) — those grant
 *    write access. StudyFlow is read-only toward Classroom and has no code that could submit,
 *    create, edit, or delete coursework.
 *  - `classroom.coursework.students*`, `classroom.rosters`, `classroom.announcements`,
 *    `classroom.profile.emails` — these expose *other people's* data and exist for teacher and
 *    administrator tools. StudyFlow is a student's planner.
 *  - `classroom.student-submissions.me.readonly` — this would reveal whether the student has turned
 *    work in. It is not requested, and the consequence is documented rather than worked around:
 *    StudyFlow's own completion status is what governs planning, and Classroom submission state is
 *    never read. See `docs/google-classroom-setup.md`.
 */
export const CLASSROOM_COURSES_READONLY_SCOPE = "https://www.googleapis.com/auth/classroom.courses.readonly";

/** Read the signed-in student's own coursework. Added in Phase 5B, when code began reading it. */
export const CLASSROOM_COURSEWORK_READONLY_SCOPE =
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly";

export const REQUESTED_SCOPES = [CLASSROOM_COURSES_READONLY_SCOPE, CLASSROOM_COURSEWORK_READONLY_SCOPE] as const;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Key material for sealing the connection cookie. Never leaves the server. */
  sessionSecret: string;
}

export type ConfigResult =
  | { ok: true; config: GoogleConfig }
  /** `missing` holds variable *names* only — printing a value would defeat the point. */
  | { ok: false; missing: string[] };

/** Minimum session-secret length. Short keys are the usual way cookie encryption ends up decorative. */
export const MIN_SESSION_SECRET_LENGTH = 32;

export const REQUIRED_ENV_VARS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "STUDYFLOW_SESSION_SECRET",
] as const;

/**
 * Reads and validates configuration. Takes the environment as an argument so tests can exercise
 * every partial-configuration case without mutating the real process environment.
 *
 * This never throws on missing configuration: an unconfigured deployment is a supported, expected
 * state that must build, boot, and run the rest of StudyFlow normally. It reports what's missing
 * and lets the caller show that honestly.
 */
export function readGoogleConfig(env: Record<string, string | undefined> = process.env): ConfigResult {
  if (typeof window !== "undefined") {
    throw new Error("readGoogleConfig is server-only — importing it from a client component would leak the OAuth client secret.");
  }

  const missing: string[] = [];
  for (const name of REQUIRED_ENV_VARS) {
    if (!env[name]?.trim()) missing.push(name);
  }

  const secret = env.STUDYFLOW_SESSION_SECRET?.trim();
  // A present-but-too-short secret is reported the same way as an absent one. It is a
  // misconfiguration either way, and the distinction isn't worth a second failure mode.
  if (secret && secret.length < MIN_SESSION_SECRET_LENGTH && !missing.includes("STUDYFLOW_SESSION_SECRET")) {
    missing.push("STUDYFLOW_SESSION_SECRET");
  }

  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      clientId: env.GOOGLE_CLIENT_ID!.trim(),
      clientSecret: env.GOOGLE_CLIENT_SECRET!.trim(),
      redirectUri: env.GOOGLE_REDIRECT_URI!.trim(),
      sessionSecret: secret!,
    },
  };
}

/** Whether this deployment can attempt a Google connection at all. */
export function isClassroomConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return readGoogleConfig(env).ok;
}

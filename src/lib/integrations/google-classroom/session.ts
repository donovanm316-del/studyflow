/**
 * Where the Google authorization actually lives.
 *
 * SERVER ONLY.
 *
 * StudyFlow has no backend and no database, and this phase does not add one. That leaves exactly
 * one place a refresh token can be kept safely on Vercel: an **encrypted, httpOnly cookie**. The
 * browser holds an opaque blob it cannot read, script cannot reach it, and only the server — which
 * alone has `STUDYFLOW_SESSION_SECRET` — can open it. This is the standard stateless-session
 * pattern, implemented with Node's own crypto so it costs no dependency.
 *
 * Two consequences worth stating plainly rather than discovering later:
 *
 *  - **Access tokens are never stored.** Only the long-lived refresh token is sealed here. Access
 *    tokens are minted per request, used, and dropped. That keeps the cookie small and well under
 *    the 4 KB browser limit (Google's access tokens are large and variable), and it means a stolen
 *    cookie is useless without the server's key.
 *  - **Rotating `STUDYFLOW_SESSION_SECRET` disconnects everyone.** Sealed cookies stop opening, and
 *    `openSession` returns `null`, which the UI shows as "not connected". Reconnecting is one
 *    click, and nothing in the student's StudyFlow data is affected.
 *
 * What is emphatically *not* used: `localStorage`. Any token in `localStorage` is readable by every
 * script on the page.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** The sealed cookie's payload. Deliberately minimal — nothing is stored that isn't needed. */
export interface ClassroomSession {
  /** Long-lived Google refresh token. The only credential StudyFlow retains. */
  refreshToken: string;
  /** Scopes Google reported granting, so the UI can state what access exists rather than assume. */
  grantedScopes: string[];
  connectedAt: string;
  /** Last time a Classroom call actually succeeded. Absent until one has. */
  lastCheckedAt?: string;
  /** Courses seen on that last successful call. Absent until one has succeeded. */
  courseCount?: number;
}

/** Holds the sealed session. The `__Host-` prefix is not used because it forbids `path` scoping we may want later. */
export const SESSION_COOKIE = "sf_gc_session";
/** Holds the OAuth `state` value between the redirect out and the callback back. */
export const OAUTH_STATE_COOKIE = "sf_gc_oauth_state";

/** Six months. Google refresh tokens for a verified app don't expire on a schedule; the cookie does. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
/** The consent round trip. Long enough for a slow account-picker, short enough to bound replay. */
export const OAUTH_STATE_MAX_AGE_SECONDS = 600;

const VERSION = "v1";
const IV_BYTES = 12; // GCM's standard nonce length
const TAG_BYTES = 16;

/**
 * Cookie flags, shared by both cookies so neither can drift from the other.
 *
 * `sameSite: "lax"` rather than `"strict"`: the OAuth callback is a top-level GET navigation from
 * accounts.google.com, and `strict` would withhold the state cookie on exactly that request,
 * breaking the CSRF check it exists to perform. `secure` is dropped on plain-HTTP localhost only,
 * where the browser would otherwise refuse to store the cookie at all.
 */
export function cookieOptions(maxAge: number, isSecure: boolean) {
  return { httpOnly: true, secure: isSecure, sameSite: "lax" as const, path: "/", maxAge };
}

/** Derives a 32-byte AES key from the configured secret. */
function keyFrom(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Encrypts and authenticates a session into a cookie-safe string. */
export function sealSession(session: ClassroomSession, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/**
 * Opens a sealed session, or returns `null`.
 *
 * Every failure — wrong key, truncated value, flipped bit, stale format, JSON that no longer
 * matches the shape — returns `null` rather than throwing. A tampered or unreadable cookie must
 * degrade to "not connected", never to a 500 that takes the Settings page down with it. GCM's
 * authentication tag makes forgery a decryption failure rather than a silently accepted payload.
 */
export function openSession(sealed: string | undefined, secret: string): ClassroomSession | null {
  if (!sealed) return null;
  const [version, payload] = sealed.split(".");
  if (version !== VERSION || !payload) return null;

  try {
    const raw = Buffer.from(payload, "base64url");
    if (raw.length <= IV_BYTES + TAG_BYTES) return null;

    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const plain = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");

    const parsed: unknown = JSON.parse(plain);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Partial<ClassroomSession>;
    if (typeof candidate.refreshToken !== "string" || !candidate.refreshToken) return null;

    return {
      refreshToken: candidate.refreshToken,
      grantedScopes: Array.isArray(candidate.grantedScopes) ? candidate.grantedScopes.filter((s) => typeof s === "string") : [],
      connectedAt: typeof candidate.connectedAt === "string" ? candidate.connectedAt : new Date().toISOString(),
      lastCheckedAt: typeof candidate.lastCheckedAt === "string" ? candidate.lastCheckedAt : undefined,
      courseCount: typeof candidate.courseCount === "number" ? candidate.courseCount : undefined,
    };
  } catch {
    return null;
  }
}

/** A random, URL-safe OAuth `state` value. */
export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

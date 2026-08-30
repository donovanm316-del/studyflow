import { describe, expect, it } from "vitest";
import {
  cookieOptions,
  createOAuthState,
  openSession,
  sealSession,
  SESSION_COOKIE,
  type ClassroomSession,
} from "./session";

const SECRET = "a-test-session-secret-at-least-32-chars";

const SESSION: ClassroomSession = {
  refreshToken: "1//refresh-token-value",
  grantedScopes: ["https://www.googleapis.com/auth/classroom.courses.readonly"],
  connectedAt: "2026-08-30T10:00:00.000Z",
};

describe("session sealing", () => {
  it("round-trips a session", () => {
    expect(openSession(sealSession(SESSION, SECRET), SECRET)).toEqual(SESSION);
  });

  it("round-trips the check metadata the UI displays", () => {
    const withCheck = { ...SESSION, lastCheckedAt: "2026-08-30T11:00:00.000Z", courseCount: 6 };
    expect(openSession(sealSession(withCheck, SECRET), SECRET)).toEqual(withCheck);
  });

  it("does not leave the refresh token readable in the cookie value", () => {
    // The whole reason for encrypting rather than merely signing: the browser holds this string.
    const sealed = sealSession(SESSION, SECRET);
    expect(sealed).not.toContain(SESSION.refreshToken);
    expect(sealed).not.toContain("refresh");
    expect(Buffer.from(sealed.split(".")[1], "base64url").toString("utf8")).not.toContain("1//");
  });

  it("produces a different ciphertext each time, so the cookie isn't a stable fingerprint", () => {
    expect(sealSession(SESSION, SECRET)).not.toBe(sealSession(SESSION, SECRET));
  });

  it("refuses a cookie sealed with a different secret", () => {
    expect(openSession(sealSession(SESSION, SECRET), "a-different-secret-of-sufficient-length")).toBeNull();
  });

  it("refuses a tampered cookie rather than trusting the payload", () => {
    // AES-GCM authenticates as well as encrypts, so a flipped byte fails to decrypt at all.
    const sealed = sealSession(SESSION, SECRET);
    const body = sealed.split(".")[1];
    const tampered = `v1.${body.slice(0, -4)}${body.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
    expect(openSession(tampered, SECRET)).toBeNull();
  });

  it("returns null — never throws — for every malformed value a browser could send", () => {
    // These all reach a live route handler. Any one of them throwing would 500 the Settings page
    // over an integration the student may not even use.
    for (const value of [undefined, "", "not-a-cookie", "v1.", "v1.!!!!", "v2.abc", "....", "v1.AAAA"]) {
      expect(openSession(value, SECRET)).toBeNull();
    }
  });

  it("rejects a payload that decrypts but carries no refresh token", () => {
    const empty = sealSession({ refreshToken: "", grantedScopes: [], connectedAt: "2026-08-30T10:00:00.000Z" }, SECRET);
    expect(openSession(empty, SECRET)).toBeNull();
  });
});

describe("cookie flags", () => {
  it("marks cookies httpOnly so page scripts can never read the token", () => {
    expect(cookieOptions(60, true).httpOnly).toBe(true);
  });

  it("uses SameSite=Lax, which the OAuth callback navigation requires", () => {
    // `strict` would withhold the state cookie on the redirect back from Google and break the
    // CSRF check it exists to perform.
    expect(cookieOptions(60, true).sameSite).toBe("lax");
  });

  it("sets Secure on https and drops it only for plain-http localhost", () => {
    expect(cookieOptions(60, true).secure).toBe(true);
    expect(cookieOptions(60, false).secure).toBe(false);
  });

  it("expires a cleared cookie immediately", () => {
    expect(cookieOptions(0, true).maxAge).toBe(0);
  });
});

describe("OAuth state", () => {
  it("is long and unpredictable", () => {
    expect(createOAuthState().length).toBeGreaterThanOrEqual(32);
    expect(new Set(Array.from({ length: 50 }, createOAuthState)).size).toBe(50);
  });

  it("is URL-safe, since it travels as a query parameter", () => {
    expect(createOAuthState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("cookie naming", () => {
  it("does not advertise its contents", () => {
    expect(SESSION_COOKIE).not.toMatch(/token|secret|refresh/i);
  });
});

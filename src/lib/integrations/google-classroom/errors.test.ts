import { describe, expect, it } from "vitest";
import { ClassroomError, classroomErrorMessage, codeForHttpStatus, toClassroomErrorCode, type ClassroomErrorCode } from "./errors";

const ALL_CODES: ClassroomErrorCode[] = [
  "not-configured",
  "oauth-denied",
  "oauth-failed",
  "invalid-credentials",
  "session-expired",
  "not-connected",
  "permission-denied",
  "classroom-unavailable",
  "rate-limited",
  "network-error",
  "no-courses",
  "unknown",
];

describe("student-facing messages", () => {
  it("has real copy for every failure, so none can fall through to a blank", () => {
    for (const code of ALL_CODES) {
      const message = classroomErrorMessage(code);
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toContain("undefined");
    }
  });

  it("never exposes Google internals, jargon, or anything token-shaped", () => {
    for (const code of ALL_CODES) {
      const message = classroomErrorMessage(code);
      expect(message).not.toMatch(/ya29|refresh_token|client_secret|invalid_grant|stack|http \d/i);
    }
  });

  it("is honest about which failures the student cannot fix", () => {
    // A setup problem must not read as something the student did wrong.
    expect(classroomErrorMessage("not-configured")).toMatch(/set up|configur/i);
    expect(classroomErrorMessage("invalid-credentials")).toMatch(/not something you can fix|StudyFlow's side/i);
  });

  it("tells the student what to do next where there is something to do", () => {
    expect(classroomErrorMessage("session-expired")).toMatch(/connect again/i);
    expect(classroomErrorMessage("permission-denied")).toMatch(/connect again/i);
    expect(classroomErrorMessage("rate-limited")).toMatch(/try again/i);
  });

  it("treats a cancelled sign-in as a choice, not a malfunction", () => {
    expect(classroomErrorMessage("oauth-denied")).toMatch(/cancelled/i);
    expect(classroomErrorMessage("oauth-denied")).not.toMatch(/error|failed|wrong/i);
  });

  it("explains an empty course list without implying something broke", () => {
    expect(classroomErrorMessage("no-courses")).toMatch(/enrolled in as a student/i);
  });
});

describe("HTTP status mapping", () => {
  it("maps the statuses Google actually returns", () => {
    expect(codeForHttpStatus(401)).toBe("session-expired");
    expect(codeForHttpStatus(403)).toBe("permission-denied");
    expect(codeForHttpStatus(429)).toBe("rate-limited");
    expect(codeForHttpStatus(500)).toBe("classroom-unavailable");
    expect(codeForHttpStatus(502)).toBe("classroom-unavailable");
  });

  it("falls back to unknown for anything unrecognized", () => {
    expect(codeForHttpStatus(418)).toBe("unknown");
  });
});

describe("classifying thrown values", () => {
  it("passes a ClassroomError's own code through", () => {
    expect(toClassroomErrorCode(new ClassroomError("rate-limited"))).toBe("rate-limited");
  });

  it("reads a failed fetch as a network error", () => {
    expect(toClassroomErrorCode(new TypeError("fetch failed"))).toBe("network-error");
  });

  it("degrades anything else to unknown instead of leaking its message", () => {
    expect(toClassroomErrorCode(new Error("token ya29.SECRET rejected at https://internal"))).toBe("unknown");
    expect(toClassroomErrorCode("a string")).toBe("unknown");
    expect(toClassroomErrorCode(null)).toBe("unknown");
  });
});

describe("ClassroomError", () => {
  it("carries the student-facing message and keeps the raw detail separate", () => {
    // `detail` is for server logs; the routes never serialize it.
    const error = new ClassroomError("session-expired", "token endpoint 400 invalid_grant");
    expect(error.message).toBe(classroomErrorMessage("session-expired"));
    expect(error.message).not.toContain("invalid_grant");
    expect(error.detail).toContain("invalid_grant");
  });
});

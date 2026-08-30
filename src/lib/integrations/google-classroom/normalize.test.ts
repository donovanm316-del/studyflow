import { describe, expect, it } from "vitest";
import { normalizeCourse, normalizeCourses, normalizeClassroomDeadline, normalizeCourseWork } from "./normalize";
import { normalizeExternalItem } from "@/lib/data/import";
import { normalizeDeadline } from "@/scheduling-engine";
import type { GoogleCourse, GoogleCourseWork } from "./types";

/**
 * Re-reads a "YYYY-MM-DDTHH:mm" local wall-clock string as a real instant.
 *
 * The deadline tests are written in terms of instants rather than literal strings on purpose: the
 * correct local rendering of a UTC timestamp depends on the machine's time zone, so asserting a
 * fixed string would only pass in whichever zone it was written in. Comparing instants asserts the
 * thing that actually matters — that no time was gained or lost in the conversion — and holds
 * everywhere.
 */
function instantOf(local: string): number {
  const [date, time] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
}

describe("course normalization", () => {
  const raw: GoogleCourse = {
    id: "123456",
    name: "AP Biology",
    section: "Period 3",
    description: "Cells, genetics, evolution",
    courseState: "ACTIVE",
    alternateLink: "https://classroom.google.com/c/123456",
    enrollmentCode: "abc123",
  };

  it("maps a Google course onto StudyFlow's shape", () => {
    expect(normalizeCourse(raw)).toEqual({
      provider: "google-classroom",
      externalCourseId: "123456",
      name: "AP Biology",
      section: "Period 3",
      description: "Cells, genetics, evolution",
      state: "active",
      url: "https://classroom.google.com/c/123456",
    });
  });

  it("keeps the Google course id, which Phase 5B's sync depends on", () => {
    expect(normalizeCourse(raw)?.externalCourseId).toBe("123456");
  });

  it("drops a course with no id — it could never be re-identified on a later sync", () => {
    expect(normalizeCourse({ ...raw, id: undefined })).toBeNull();
  });

  it("drops a course with no name rather than inventing 'Untitled course'", () => {
    // A fabricated name would show up in the UI as a real class the student didn't recognize.
    expect(normalizeCourse({ ...raw, name: "  " })).toBeNull();
  });

  it("passes Classroom's lifecycle state through instead of collapsing it to active", () => {
    expect(normalizeCourse({ ...raw, courseState: "ARCHIVED" })?.state).toBe("archived");
    expect(normalizeCourse({ ...raw, courseState: "PROVISIONED" })?.state).toBe("provisioned");
  });

  it("marks a state it doesn't recognize as unknown rather than guessing active", () => {
    expect(normalizeCourse({ ...raw, courseState: "SOMETHING_NEW" })?.state).toBe("unknown");
    expect(normalizeCourse({ ...raw, courseState: undefined })?.state).toBe("unknown");
  });

  it("falls back to the description heading when there's no description", () => {
    expect(normalizeCourse({ ...raw, description: undefined, descriptionHeading: "Unit 4" })?.description).toBe("Unit 4");
  });

  it("leaves optional fields absent rather than filling them with empty strings", () => {
    const sparse = normalizeCourse({ id: "1", name: "Math" });
    expect(sparse?.section).toBeUndefined();
    expect(sparse?.description).toBeUndefined();
    expect(sparse?.url).toBeUndefined();
  });

  it("skips unusable entries without losing the rest of the page", () => {
    const courses = normalizeCourses([raw, { id: "no-name" }, { ...raw, id: "789", name: "Chemistry" }]);
    expect(courses.map((c) => c.name)).toEqual(["AP Biology", "Chemistry"]);
  });

  it("returns an empty list for an empty response", () => {
    expect(normalizeCourses([])).toEqual([]);
  });
});

describe("deadline normalization", () => {
  it("preserves an exact due time as the same instant, not a different one", () => {
    const deadline = normalizeClassroomDeadline({ year: 2026, month: 9, day: 4 }, { hours: 20, minutes: 30 });
    expect(deadline?.hasExactTime).toBe(true);
    expect(instantOf(deadline!.value)).toBe(Date.UTC(2026, 8, 4, 20, 30));
  });

  it("never turns a known due time into midnight", () => {
    // The Phase 4.5A guarantee: a real time from Classroom must survive intact.
    const deadline = normalizeClassroomDeadline({ year: 2026, month: 9, day: 4 }, { hours: 23, minutes: 59 });
    expect(deadline!.value.endsWith("T00:00")).toBe(false);
    expect(instantOf(deadline!.value)).toBe(Date.UTC(2026, 8, 4, 23, 59));
  });

  it("keeps a date-only deadline date-only, so StudyFlow's own default applies", () => {
    // Google gave no time, so none is invented here. `normalizeDeadline` stays the single place
    // the 11:59 PM convention lives.
    const deadline = normalizeClassroomDeadline({ year: 2026, month: 9, day: 4 }, undefined);
    expect(deadline).toEqual({ value: "2026-09-04", hasExactTime: false });
    expect(normalizeDeadline(deadline!.value)).toBe("2026-09-04T23:59");
  });

  it("does not time-shift a date-only deadline", () => {
    // A bare date names no instant, so converting time zones would mean inventing one.
    expect(normalizeClassroomDeadline({ year: 2026, month: 1, day: 1 }, undefined)?.value).toBe("2026-01-01");
    expect(normalizeClassroomDeadline({ year: 2026, month: 12, day: 31 }, undefined)?.value).toBe("2026-12-31");
  });

  it("treats a present-but-empty dueTime as midnight UTC, not as an absent time", () => {
    // The protobuf zero-value trap: Classroom omits zero fields, so 00:00 UTC serializes as `{}`.
    // Testing truthiness of `dueTime.hours` here would silently reclassify every midnight-UTC
    // deadline as date-only and move it to 11:59 PM local — a full day of false slack.
    const deadline = normalizeClassroomDeadline({ year: 2026, month: 9, day: 4 }, {});
    expect(deadline?.hasExactTime).toBe(true);
    expect(instantOf(deadline!.value)).toBe(Date.UTC(2026, 8, 4, 0, 0));
  });

  it("returns null when Classroom carries no due date at all", () => {
    expect(normalizeClassroomDeadline(undefined, undefined)).toBeNull();
    expect(normalizeClassroomDeadline({ year: 2026, month: 9 }, undefined)).toBeNull();
  });

  it("pads single-digit months, days and times", () => {
    const deadline = normalizeClassroomDeadline({ year: 2026, month: 1, day: 5 }, undefined);
    expect(deadline?.value).toBe("2026-01-05");
  });
});

describe("coursework normalization", () => {
  const work: GoogleCourseWork = {
    id: "cw-1",
    courseId: "123456",
    title: "Chapter 7 problem set",
    state: "PUBLISHED",
    alternateLink: "https://classroom.google.com/c/123456/a/cw-1",
    dueDate: { year: 2026, month: 9, day: 4 },
    dueTime: { hours: 16, minutes: 0 },
    updateTime: "2026-08-30T12:00:00.000Z",
  };

  it("produces the Phase 4.5D import shape, so the existing boundary is reused", () => {
    const item = normalizeCourseWork(work, "AP Biology");
    expect(item?.source).toBe("google-classroom");
    expect(item?.externalId).toBe("cw-1");
    expect(item?.externalCourseId).toBe("123456");
    expect(item?.courseName).toBe("AP Biology");
    expect(item?.externalUrl).toBe("https://classroom.google.com/c/123456/a/cw-1");
    expect(item?.sourceUpdatedAt).toBe("2026-08-30T12:00:00.000Z");
  });

  it("invents no estimate, importance, or work type — Classroom knows none of them", () => {
    const item = normalizeCourseWork(work) as unknown as Record<string, unknown>;
    expect(item.estimatedMinutes).toBeUndefined();
    expect(item.weight).toBeUndefined();
    expect(item.workType).toBeUndefined();
  });

  it("carries a due time all the way through to a StudyFlow deadline unchanged", () => {
    const item = normalizeCourseWork(work)!;
    const input = normalizeExternalItem(item, "2026-08-30");
    expect(instantOf(input.dueDate)).toBe(Date.UTC(2026, 8, 4, 16, 0));
  });

  it("leaves a due-date-less item without a date, for the importer to flag", () => {
    expect(normalizeCourseWork({ ...work, dueDate: undefined, dueTime: undefined })?.dueDate).toBeUndefined();
  });

  it("drops coursework with no id or no title", () => {
    expect(normalizeCourseWork({ ...work, id: undefined })).toBeNull();
    expect(normalizeCourseWork({ ...work, title: "" })).toBeNull();
  });
});

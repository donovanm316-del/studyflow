import { describe, expect, it } from "vitest";
import { findImportedMatch, mergeImportedItem, normalizeExternalItem, snapshotOf, type ExternalWorkItem } from "./import";
import type { SchedulableWorkItem } from "@/scheduling-engine";

const TODAY = "2026-08-24";

const external: ExternalWorkItem = {
  source: "google-classroom",
  externalId: "gc-123",
  externalCourseId: "course-1",
  title: "Chapter 7 Problems",
  dueDate: "2026-08-28T15:00",
  courseName: "AP Biology",
  externalUrl: "https://classroom.example/a/gc-123",
};

function imported(overrides: Partial<SchedulableWorkItem> = {}): SchedulableWorkItem {
  return {
    kind: "assignment",
    id: "i1",
    userId: "u1",
    title: "Chapter 7 Problems",
    subject: "AP Biology",
    dueDate: "2026-08-28T15:00",
    status: "not-started",
    estimatedMinutes: 30,
    weight: "medium",
    deadlineStrictness: "hard",
    workType: "homework",
    source: "google-classroom",
    externalId: "gc-123",
    externalCourseId: "course-1",
    externalUrl: "https://classroom.example/a/gc-123",
    sourceSnapshot: snapshotOf(external),
    createdAt: "2026-08-20T08:00",
    updatedAt: "2026-08-20T08:00",
    ...overrides,
  } as SchedulableWorkItem;
}

describe("normalizeExternalItem", () => {
  it("produces the same input shape the add-assignment form produces", () => {
    const input = normalizeExternalItem(external, TODAY)!;

    expect(input.title).toBe("Chapter 7 Problems");
    expect(input.subject).toBe("AP Biology");
    expect(input.dueDate).toBe("2026-08-28T15:00");
    expect(input.source).toBe("google-classroom");
    expect(input.externalId).toBe("gc-123");
    expect(input.externalCourseId).toBe("course-1");
  });

  it("reads a date-only external due date as the end of that day", () => {
    expect(normalizeExternalItem({ ...external, dueDate: "2026-08-28" }, TODAY)!.dueDate).toBe("2026-08-28T23:59");
  });

  it("refuses to import an item with no deadline at all, rather than inventing one", () => {
    // Defaulting to "today at 11:59 PM" would inject fabricated urgency into a real week. The
    // review screen asks for a date instead (Part 19).
    expect(normalizeExternalItem({ ...external, dueDate: undefined }, TODAY)).toBeNull();
  });

  it("imports an undated item once the student supplies a target date", () => {
    const input = normalizeExternalItem({ ...external, dueDate: undefined }, TODAY, { targetDate: "2026-09-10" })!;
    expect(input.dueDate).toBe("2026-09-10T23:59");
  });

  it("treats a student-chosen date as a target, not as a hard deadline the teacher set", () => {
    const input = normalizeExternalItem({ ...external, dueDate: undefined }, TODAY, { targetDate: "2026-09-10" })!;
    expect(input.deadlineStrictness).toBe("target");
  });

  it("keeps a real Classroom deadline strict", () => {
    expect(normalizeExternalItem(external, TODAY)!.deadlineStrictness).toBe("hard");
  });

  it("falls back to a readable title rather than importing a blank one", () => {
    expect(normalizeExternalItem({ ...external, title: "   " }, TODAY)!.title).toBe("Untitled assignment");
  });

  it("flags an unestimated import instead of passing the placeholder off as an estimate", () => {
    // The engine needs a number; `needsEstimate` is what stops that number from lying.
    const input = normalizeExternalItem(external, TODAY)!;
    expect(input.estimatedMinutes).toBe(30);
    expect(input.needsEstimate).toBe(true);
  });

  it("takes the student's estimate when they gave one, and drops the flag", () => {
    const input = normalizeExternalItem(external, TODAY, { estimatedMinutes: 90 })!;
    expect(input.estimatedMinutes).toBe(90);
    expect(input.needsEstimate).toBeUndefined();
  });

  it("records a comparison baseline of the source-owned fields", () => {
    expect(normalizeExternalItem(external, TODAY)!.sourceSnapshot).toEqual({
      title: "Chapter 7 Problems",
      dueDate: "2026-08-28T15:00",
      courseName: "AP Biology",
    });
  });

  it("supplies student-owned planning fields from defaults, since no external system knows them", () => {
    const input = normalizeExternalItem(external, TODAY)!;
    expect(input.weight).toBe("medium");
    expect(input.workType).toBe("homework");
  });
});

describe("findImportedMatch", () => {
  it("matches on source and external id, not on title", () => {
    const existing = [imported({ title: "Renamed by the student" })];
    expect(findImportedMatch(existing, external)?.id).toBe("i1");
  });

  it("does not match a manually created item that happens to share a title", () => {
    const manual = imported({ source: undefined, externalId: undefined });
    expect(findImportedMatch([manual], external)).toBeUndefined();
  });

  it("does not match the same id from a different source", () => {
    expect(findImportedMatch([imported()], { ...external, source: "manual" })).toBeUndefined();
  });
});

describe("mergeImportedItem — re-import must not overwrite the student", () => {
  it("returns null when the source has nothing new to say", () => {
    expect(mergeImportedItem(imported(), external)).toBeNull();
  });

  it("refreshes the fields the source genuinely owns", () => {
    const changed = { ...external, title: "Chapter 7 Problems (revised)", dueDate: "2026-08-30T09:00" };
    const patch = mergeImportedItem(imported(), changed);

    expect(patch).not.toBeNull();
    expect(patch!.title).toBe("Chapter 7 Problems (revised)");
    expect(patch!.dueDate).toBe("2026-08-30T09:00");
  });

  it("never touches the student's own planning decisions", () => {
    const studentEdited = imported({
      estimatedMinutes: 180,
      weight: "high",
      deadlineStrictness: "flexible",
      preferredStartDate: "2026-08-26",
      usePersonalizedEstimate: false,
      actualMinutes: 45,
      status: "in-progress",
    });
    const patch = mergeImportedItem(studentEdited, { ...external, title: "New title" }) ?? {};

    for (const field of [
      "estimatedMinutes",
      "weight",
      "deadlineStrictness",
      "preferredStartDate",
      "usePersonalizedEstimate",
      "workType",
      "status",
      "actualMinutes",
    ]) {
      expect(patch).not.toHaveProperty(field);
    }
    expect(patch.title).toBe("New title");
  });

  it("compares against the snapshot, so a student's own rename isn't reverted on every sync", () => {
    // The student renamed their copy; Classroom still says what it always said. Comparing against
    // the item's live title would report a change and rename it back, every single sync.
    const renamedByStudent = imported({ title: "Bio — ch.7 (do the odd ones)" });
    expect(mergeImportedItem(renamedByStudent, external)).toBeNull();
  });

  it("still detects a real teacher change on an item the student renamed", () => {
    const renamedByStudent = imported({ title: "Bio — ch.7 (do the odd ones)" });
    const patch = mergeImportedItem(renamedByStudent, { ...external, dueDate: "2026-08-27T15:00" });
    expect(patch!.dueDate).toBe("2026-08-27T15:00");
    expect(patch).not.toHaveProperty("title");
  });

  it("advances the snapshot with the patch, so the same change isn't reported twice", () => {
    const patch = mergeImportedItem(imported(), { ...external, title: "Revised" })!;
    expect(patch.sourceSnapshot).toEqual({ title: "Revised", dueDate: "2026-08-28T15:00", courseName: "AP Biology" });
  });

  it("never clears a student's target date when the source still has no deadline", () => {
    // An undated item was imported against a date the student chose. A sync must not wipe it.
    const withTarget = imported({ dueDate: "2026-09-10T23:59", sourceSnapshot: { title: "Chapter 7 Problems", courseName: "AP Biology" } });
    const patch = mergeImportedItem(withTarget, { ...external, dueDate: undefined });
    expect(patch).toBeNull();
  });

  it("treats a legacy date-only stored deadline as equal to its normalized form", () => {
    // Otherwise every re-import would report a spurious due-date change on older items.
    const legacy = imported({ dueDate: "2026-08-28", sourceSnapshot: undefined });
    expect(mergeImportedItem(legacy, { ...external, dueDate: "2026-08-28T23:59" })).toBeNull();
  });
});

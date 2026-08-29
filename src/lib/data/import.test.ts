import { describe, expect, it } from "vitest";
import { findImportedMatch, mergeImportedItem, normalizeExternalItem, type ExternalWorkItem } from "./import";
import type { SchedulableWorkItem } from "@/scheduling-engine";

const TODAY = "2026-08-24";

const external: ExternalWorkItem = {
  source: "google-classroom",
  externalId: "gc-123",
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
    externalUrl: "https://classroom.example/a/gc-123",
    createdAt: "2026-08-20T08:00",
    updatedAt: "2026-08-20T08:00",
    ...overrides,
  } as SchedulableWorkItem;
}

describe("normalizeExternalItem", () => {
  it("produces the same input shape the add-assignment form produces", () => {
    const input = normalizeExternalItem(external, TODAY);

    expect(input.title).toBe("Chapter 7 Problems");
    expect(input.subject).toBe("AP Biology");
    expect(input.dueDate).toBe("2026-08-28T15:00");
    expect(input.source).toBe("google-classroom");
    expect(input.externalId).toBe("gc-123");
  });

  it("reads a date-only external due date as the end of that day", () => {
    expect(normalizeExternalItem({ ...external, dueDate: "2026-08-28" }, TODAY).dueDate).toBe("2026-08-28T23:59");
  });

  it("gives a due-date-less item a visible, correctable deadline instead of dropping it", () => {
    const input = normalizeExternalItem({ ...external, dueDate: undefined }, TODAY);
    expect(input.dueDate).toBe(`${TODAY}T23:59`);
  });

  it("falls back to a readable title rather than importing a blank one", () => {
    expect(normalizeExternalItem({ ...external, title: "   " }, TODAY).title).toBe("Untitled assignment");
  });

  it("supplies student-owned planning fields from defaults, since no external system knows them", () => {
    const input = normalizeExternalItem(external, TODAY);
    expect(input.estimatedMinutes).toBe(30);
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
    expect(mergeImportedItem(imported(), external, TODAY)).toBeNull();
  });

  it("refreshes the fields the source genuinely owns", () => {
    const changed = { ...external, title: "Chapter 7 Problems (revised)", dueDate: "2026-08-30T09:00" };
    const patch = mergeImportedItem(imported(), changed, TODAY);

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
    const patch = mergeImportedItem(studentEdited, { ...external, title: "New title" }, TODAY) ?? {};

    for (const field of [
      "estimatedMinutes",
      "weight",
      "deadlineStrictness",
      "preferredStartDate",
      "usePersonalizedEstimate",
      "workType",
    ]) {
      expect(patch).not.toHaveProperty(field);
    }
    expect(patch.title).toBe("New title");
  });

  it("treats a legacy date-only stored deadline as equal to its normalized form", () => {
    // Otherwise every re-import would report a spurious due-date change on older items.
    const legacy = imported({ dueDate: "2026-08-28" });
    expect(mergeImportedItem(legacy, { ...external, dueDate: "2026-08-28T23:59" }, TODAY)).toBeNull();
  });
});

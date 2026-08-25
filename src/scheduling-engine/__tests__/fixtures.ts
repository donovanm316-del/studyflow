import type { Assignment, Commitment, PlanningProfile, Project, ScheduleFeedback, Test as TestItem } from "@/types/models";

export const NOW = "2026-08-24T08:00:00"; // a Monday

export function makePlanningProfile(overrides: Partial<PlanningProfile> = {}): PlanningProfile {
  return {
    userId: "u1",
    dailyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      earliest: "15:00",
      latest: "21:00",
    })),
    preferredSessionMinutes: 45,
    bufferDays: 1,
    autoBreaks: true,
    workloadTolerance: "moderate",
    breakPreference: "balanced",
    freeTimePriority: "medium",
    workStyle: "early",
    ...overrides,
  };
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}${idCounter}`;
}

export function makeAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: nextId("a"),
    userId: "u1",
    title: "Assignment",
    subject: "Test Subject",
    dueDate: "2026-08-27T23:59:00",
    status: "not-started",
    estimatedMinutes: 60,
    weight: "medium",
    deadlineStrictness: "important",
    workType: "homework",
    kind: "assignment",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeTest(overrides: Partial<TestItem> = {}): TestItem {
  return {
    id: nextId("t"),
    userId: "u1",
    title: "Test",
    subject: "Test Subject",
    dueDate: "2026-08-27T23:59:00",
    status: "not-started",
    estimatedMinutes: 90,
    weight: "high",
    deadlineStrictness: "hard",
    workType: "test-prep",
    kind: "test",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: nextId("p"),
    userId: "u1",
    title: "Project",
    subject: "Test Subject",
    dueDate: "2026-08-30T23:59:00",
    status: "not-started",
    estimatedMinutes: 240,
    weight: "high",
    deadlineStrictness: "important",
    workType: "project",
    kind: "project",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeCommitment(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: nextId("c"),
    userId: "u1",
    title: "Commitment",
    category: "extracurricular",
    recurrence: { type: "weekly", daysOfWeek: [1, 3] },
    startTime: "16:00",
    endTime: "17:30",
    ...overrides,
  };
}

export function makeFeedback(
  workloadFeeling: ScheduleFeedback["workloadFeeling"],
  createdAt: string,
  overrides: Partial<ScheduleFeedback> = {}
): ScheduleFeedback {
  return {
    id: nextId("fb"),
    userId: "u1",
    dateRange: { start: "2026-08-17", end: "2026-08-23" },
    workloadFeeling,
    createdAt,
    ...overrides,
  };
}

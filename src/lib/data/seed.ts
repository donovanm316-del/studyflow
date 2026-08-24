/**
 * One-time sample data used to seed local storage on first load, so the app has something to
 * schedule out of the box. This is not a database and not "real" persistence beyond the
 * student's own browser — see `store.tsx` for how it's loaded/saved.
 */
import type { Assignment, Commitment, PlanningProfile, Project, Quiz, Test } from "@/types/models";

const DEMO_USER_ID = "demo-user";

function addDaysToDateOnly(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date
    .getDate()
    .toString()
    .padStart(2, "0")}`;
}

export interface SeedData {
  workItems: (Assignment | Test | Quiz | Project)[];
  commitments: Commitment[];
  planningProfile: PlanningProfile;
}

export function createSeedData(todayDateOnly: string): SeedData {
  const due = (daysFromNow: number, time = "23:59") => `${addDaysToDateOnly(todayDateOnly, daysFromNow)}T${time}`;
  const now = `${todayDateOnly}T08:00`;

  const workItems: (Assignment | Test | Quiz | Project)[] = [
    {
      id: "seed-a1",
      userId: DEMO_USER_ID,
      kind: "assignment",
      title: "Read Ch. 12 — Cell Respiration",
      subject: "Biology",
      dueDate: due(1),
      status: "not-started",
      estimatedMinutes: 30,
      weight: "low",
      deadlineStrictness: "hard",
      workType: "reading",
      rigor: "grade_level",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-a2",
      userId: DEMO_USER_ID,
      kind: "assignment",
      title: "Worksheet 6.3",
      subject: "Algebra II",
      dueDate: due(2),
      status: "not-started",
      estimatedMinutes: 25,
      weight: "medium",
      deadlineStrictness: "hard",
      workType: "homework",
      rigor: "grade_level",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-t1",
      userId: DEMO_USER_ID,
      kind: "test",
      title: "Unit 4 Test",
      subject: "Algebra II",
      dueDate: due(3),
      status: "not-started",
      estimatedMinutes: 120,
      weight: "high",
      deadlineStrictness: "hard",
      workType: "test-prep",
      scope: "unit-test",
      rigor: "grade_level",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-q1",
      userId: DEMO_USER_ID,
      kind: "quiz",
      title: "Pop quiz — vocabulary",
      subject: "Spanish",
      dueDate: due(1),
      status: "not-started",
      estimatedMinutes: 15,
      weight: "low",
      deadlineStrictness: "important",
      workType: "quiz-prep",
      rigor: "grade_level",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-p1",
      userId: DEMO_USER_ID,
      kind: "project",
      title: "Lab report — Chemical Reactions",
      subject: "Chemistry",
      dueDate: due(6),
      status: "in-progress",
      estimatedMinutes: 240,
      actualMinutes: 45,
      weight: "high",
      deadlineStrictness: "important",
      workType: "project",
      rigor: "honors",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed-a3",
      userId: DEMO_USER_ID,
      kind: "assignment",
      title: "Response paragraph — Ch. 5",
      subject: "English",
      dueDate: due(4),
      status: "not-started",
      estimatedMinutes: 45,
      weight: "medium",
      deadlineStrictness: "flexible",
      workType: "essay",
      rigor: "grade_level",
      createdAt: now,
      updatedAt: now,
    },
  ];

  const commitments: Commitment[] = [
    {
      id: "seed-c1",
      userId: DEMO_USER_ID,
      title: "Morning practice",
      category: "extracurricular",
      recurrence: { type: "weekly", daysOfWeek: [1, 3, 5] },
      startTime: "07:00",
      endTime: "08:00",
    },
    {
      id: "seed-c2",
      userId: DEMO_USER_ID,
      title: "School",
      category: "other",
      recurrence: { type: "weekly", daysOfWeek: [1, 2, 3, 4, 5] },
      startTime: "08:15",
      endTime: "15:00",
    },
  ];

  const planningProfile: PlanningProfile = {
    userId: DEMO_USER_ID,
    dailyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      earliest: dayOfWeek === 0 || dayOfWeek === 6 ? "10:00" : "15:30",
      latest: "21:00",
    })),
    preferredSessionMinutes: 45,
    bufferDays: 1,
    autoBreaks: true,
    workloadTolerance: "moderate",
    breakPreference: "balanced",
    freeTimePriority: "medium",
    workStyle: "early",
  };

  return { workItems, commitments, planningProfile };
}

export { DEMO_USER_ID };

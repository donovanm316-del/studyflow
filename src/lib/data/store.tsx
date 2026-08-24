"use client";

/**
 * Client-side application state for Phase 2. There is no backend yet — everything here lives in
 * the browser's localStorage, scoped to one demo user. This is real (not fake) persistence: it
 * survives reloads, it just isn't synced anywhere. A future phase can replace this module with a
 * real data layer without touching the scheduling engine or most of the UI, since components only
 * ever call the actions exposed by `useAppData()`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createSeedData, DEMO_USER_ID } from "./seed";
import { todayDateOnly } from "@/lib/now";
import type {
  Commitment,
  PlanningProfile,
  ScheduleBlock,
  ScheduleFeedback,
  WorkSession,
} from "@/types/models";
import type { SchedulableWorkItem } from "@/scheduling-engine";

const STORAGE_KEY = "studyflow.appData.v1";

interface AppState {
  workItems: SchedulableWorkItem[];
  commitments: Commitment[];
  planningProfile: PlanningProfile;
  /** Only completed/skipped/manual-override blocks are persisted — generated ones are recomputed live. */
  fixedBlocks: ScheduleBlock[];
  workSessions: WorkSession[];
  feedback: ScheduleFeedback[];
}

/**
 * A static, date-free starting point — used for both server rendering and the client's very
 * first (pre-mount) render. It has to be identical on both sides or React throws a hydration
 * mismatch. The seed data (and any saved localStorage data) is date-dependent, so it can only be
 * loaded after mount — see the effect below.
 */
const EMPTY_STATE: AppState = {
  workItems: [],
  commitments: [],
  planningProfile: {
    userId: DEMO_USER_ID,
    dailyAvailability: [],
    preferredSessionMinutes: 45,
    bufferDays: 1,
    autoBreaks: true,
    workloadTolerance: "moderate",
    breakPreference: "balanced",
    freeTimePriority: "medium",
    workStyle: "early",
  },
  fixedBlocks: [],
  workSessions: [],
  feedback: [],
};

export type NewWorkItemInput = Omit<SchedulableWorkItem, "id" | "userId" | "status" | "createdAt" | "updatedAt">;

interface AppDataContextValue extends AppState {
  /** False until client-side data (saved or freshly seeded) has replaced the placeholder empty state. */
  hydrated: boolean;
  addWorkItem: (input: NewWorkItemInput) => void;
  markWorkItemComplete: (id: string) => void;
  markWorkItemIncomplete: (id: string) => void;
  completeBlock: (block: ScheduleBlock, actualMinutes: number) => void;
  skipBlock: (block: ScheduleBlock) => void;
  moveBlock: (block: ScheduleBlock, newStart: string, newEnd: string) => void;
  regenerateFrom: (dateOnly: string) => void;
  addCommitment: (input: Omit<Commitment, "id" | "userId">) => void;
  updatePlanningProfile: (patch: Partial<PlanningProfile>) => void;
  submitFeedback: (feedback: Omit<ScheduleFeedback, "id" | "userId" | "createdAt">) => void;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Load saved state (or seed fresh data, for a first-ever visit) after mount. This has to run
  // client-side — localStorage doesn't exist during server rendering, and seeding uses today's
  // real date, which would disagree with whatever date a statically-built server render happened
  // to freeze in and trigger a hydration mismatch if it ran any earlier than the initial render.
  useEffect(() => {
    let next: AppState | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) next = JSON.parse(raw) as AppState;
    } catch {
      // Corrupt or inaccessible storage — fall through to seeding fresh data below.
    }
    if (!next) {
      const seed = createSeedData(todayDateOnly());
      next = { ...seed, fixedBlocks: [], workSessions: [], feedback: [] };
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time load from an external store, not a derived-state loop
    setState(next);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full or unavailable (e.g. private browsing) — state still works for this session.
    }
  }, [state, hydrated]);

  const addWorkItem = useCallback((input: NewWorkItemInput) => {
    const now = new Date().toISOString();
    setState((s) => ({
      ...s,
      workItems: [
        ...s.workItems,
        { ...input, id: newId("item"), userId: DEMO_USER_ID, status: "not-started", createdAt: now, updatedAt: now } as SchedulableWorkItem,
      ],
    }));
  }, []);

  const markWorkItemComplete = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      workItems: s.workItems.map((item) =>
        item.id === id ? { ...item, status: "completed", updatedAt: new Date().toISOString() } : item
      ),
    }));
  }, []);

  const markWorkItemIncomplete = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      workItems: s.workItems.map((item) =>
        item.id === id
          ? { ...item, status: (item.actualMinutes ?? 0) > 0 ? "in-progress" : "not-started", updatedAt: new Date().toISOString() }
          : item
      ),
    }));
  }, []);

  const completeBlock = useCallback((block: ScheduleBlock, actualMinutes: number) => {
    setState((s) => {
      const plannedMinutes = minutesBetween(block.start, block.end);
      const session: WorkSession = {
        id: newId("session"),
        userId: DEMO_USER_ID,
        workItemId: block.workItemId ?? "",
        scheduleBlockId: block.id,
        start: block.start,
        end: block.end,
        plannedMinutes,
        minutesSpent: actualMinutes,
      };
      return {
        ...s,
        fixedBlocks: [...s.fixedBlocks, { ...block, status: "completed" }],
        workSessions: block.workItemId ? [...s.workSessions, session] : s.workSessions,
        workItems: block.workItemId
          ? s.workItems.map((item) => {
              if (item.id !== block.workItemId) return item;
              const newActual = (item.actualMinutes ?? 0) + actualMinutes;
              return {
                ...item,
                actualMinutes: newActual,
                status: newActual >= item.estimatedMinutes ? "completed" : "in-progress",
                updatedAt: new Date().toISOString(),
              };
            })
          : s.workItems,
      };
    });
  }, []);

  const skipBlock = useCallback((block: ScheduleBlock) => {
    setState((s) => {
      const session: WorkSession | null = block.workItemId
        ? {
            id: newId("session"),
            userId: DEMO_USER_ID,
            workItemId: block.workItemId,
            scheduleBlockId: block.id,
            start: block.start,
            end: block.end,
            plannedMinutes: minutesBetween(block.start, block.end),
            postponed: true,
          }
        : null;
      return {
        ...s,
        fixedBlocks: [...s.fixedBlocks, { ...block, status: "skipped" }],
        workSessions: session ? [...s.workSessions, session] : s.workSessions,
      };
    });
  }, []);

  const moveBlock = useCallback((block: ScheduleBlock, newStart: string, newEnd: string) => {
    setState((s) => ({
      ...s,
      fixedBlocks: [
        ...s.fixedBlocks,
        { ...block, start: newStart, end: newEnd, origin: "manual-override", status: "planned" },
      ],
    }));
  }, []);

  const regenerateFrom = useCallback((dateOnly: string) => {
    setState((s) => ({
      ...s,
      fixedBlocks: s.fixedBlocks.filter((b) => !(b.origin === "manual-override" && b.status === "planned" && b.start.slice(0, 10) >= dateOnly)),
    }));
  }, []);

  const addCommitment = useCallback((input: Omit<Commitment, "id" | "userId">) => {
    setState((s) => ({
      ...s,
      commitments: [...s.commitments, { ...input, id: newId("commitment"), userId: DEMO_USER_ID }],
    }));
  }, []);

  const updatePlanningProfile = useCallback((patch: Partial<PlanningProfile>) => {
    setState((s) => ({ ...s, planningProfile: { ...s.planningProfile, ...patch } }));
  }, []);

  const submitFeedback = useCallback((feedback: Omit<ScheduleFeedback, "id" | "userId" | "createdAt">) => {
    setState((s) => ({
      ...s,
      feedback: [...s.feedback, { ...feedback, id: newId("feedback"), userId: DEMO_USER_ID, createdAt: new Date().toISOString() }],
    }));
  }, []);

  const value = useMemo<AppDataContextValue>(
    () => ({
      ...state,
      hydrated,
      addWorkItem,
      markWorkItemComplete,
      markWorkItemIncomplete,
      completeBlock,
      skipBlock,
      moveBlock,
      regenerateFrom,
      addCommitment,
      updatePlanningProfile,
      submitFeedback,
    }),
    [state, hydrated, addWorkItem, markWorkItemComplete, markWorkItemIncomplete, completeBlock, skipBlock, moveBlock, regenerateFrom, addCommitment, updatePlanningProfile, submitFeedback]
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within an AppDataProvider");
  return ctx;
}

function minutesBetween(startIso: string, endIso: string): number {
  const [, startTime] = startIso.split("T");
  const [, endTime] = endIso.split("T");
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

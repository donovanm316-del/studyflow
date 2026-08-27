"use client";

/**
 * Client-side application state (Phase 2, extended in Phase 3A with interactive sessions,
 * replanning, and commitment management). There is no backend yet — everything here lives in
 * the browser's localStorage, scoped to one demo user. This is real (not fake) persistence: it
 * survives reloads, it just isn't synced anywhere. A future phase can replace this module with a
 * real data layer without touching the scheduling engine or most of the UI, since components only
 * ever call the actions exposed by `useAppData()`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type {
  ActiveWorkSession,
  Commitment,
  PlanningProfile,
  ScheduleBlock,
  ScheduleFeedback,
  WorkSession,
  WorkStage,
} from "@/types/models";
import {
  calculateBreakPreferenceAdjustment,
  calculateFreeTimePriorityAdjustment,
  renumberStages,
  type SchedulableWorkItem,
} from "@/scheduling-engine";

const STORAGE_KEY = "studyflow.appData.v1";

/** No real accounts yet (Settings' Profile section is still a placeholder) — one local user id. */
const DEMO_USER_ID = "demo-user";

interface AppState {
  workItems: SchedulableWorkItem[];
  commitments: Commitment[];
  planningProfile: PlanningProfile;
  /** Only completed/skipped/manual-override blocks are persisted — generated ones are recomputed live. */
  fixedBlocks: ScheduleBlock[];
  workSessions: WorkSession[];
  feedback: ScheduleFeedback[];
  /** Stages for decomposed work items (Phase 4), across every item — grouped by `workItemId` where
   *  needed. Empty for any item the student hasn't chosen to plan in stages. */
  stages: WorkStage[];
  /** At most one work session in progress at a time (Phase 3A, Part 4). */
  activeSession: ActiveWorkSession | null;
  /**
   * False only for a genuine first-ever visit (no saved data at all) — gates the onboarding
   * redirect in `(app)/layout.tsx`. Existing users are never sent back through onboarding: see
   * the hydration effect below, which defaults this to `true` for any successfully loaded save,
   * even one from before this field existed.
   */
  onboardingComplete: boolean;
}

const DEFAULT_PLANNING_PROFILE: PlanningProfile = {
  userId: DEMO_USER_ID,
  dailyAvailability: [],
  preferredSessionMinutes: 45,
  bufferDays: 1,
  autoBreaks: true,
  workloadTolerance: "moderate",
  breakPreference: "balanced",
  freeTimePriority: "medium",
  workStyle: "early",
};

/**
 * A static, date-free starting point — used for both server rendering and the client's very
 * first (pre-mount) render. It has to be identical on both sides or React throws a hydration
 * mismatch. Any saved (or freshly-initialized) real data is date-dependent, so it can only be
 * loaded after mount — see the effect below. `onboardingComplete: true` here is a safe default
 * for this placeholder render — the real value (and any onboarding redirect) only takes effect
 * once `hydrated` is true.
 */
const EMPTY_STATE: AppState = {
  workItems: [],
  commitments: [],
  planningProfile: DEFAULT_PLANNING_PROFILE,
  fixedBlocks: [],
  workSessions: [],
  feedback: [],
  stages: [],
  activeSession: null,
  onboardingComplete: true,
};

export type NewWorkItemInput = Omit<SchedulableWorkItem, "id" | "userId" | "status" | "createdAt" | "updatedAt">;

interface AppDataContextValue extends AppState {
  /** False until client-side data (saved or freshly initialized) has replaced the placeholder empty state. */
  hydrated: boolean;
  /** True if the last localStorage write failed (e.g. private browsing, storage full) — data still
   *  works for this session, it just won't survive a reload. Surfaced as a small honest banner. */
  storageWarning: boolean;
  addWorkItem: (input: NewWorkItemInput) => void;
  updateWorkItem: (id: string, patch: Partial<NewWorkItemInput>) => void;
  removeWorkItem: (id: string) => void;
  markWorkItemComplete: (id: string) => void;
  markWorkItemIncomplete: (id: string) => void;
  /** Accepts a (possibly student-edited) proposed stage breakdown for a work item (Phase 4). */
  acceptDecomposition: (workItemId: string, stages: WorkStage[]) => void;
  /** "Keep as one task" — clears a work item's stages. */
  clearStages: (workItemId: string) => void;
  updateStage: (id: string, patch: Partial<Pick<WorkStage, "title" | "estimatedMinutes" | "status" | "actualMinutes">>) => void;
  removeStage: (id: string) => void;
  addStage: (workItemId: string, title: string, estimatedMinutes: number) => void;
  completeBlock: (
    block: ScheduleBlock,
    actualMinutes: number,
    estimateFeedback?: WorkSession["estimateFeedback"]
  ) => void;
  skipBlock: (block: ScheduleBlock) => void;
  moveBlock: (block: ScheduleBlock, newStart: string, newEnd: string) => void;
  /** "I can't do this today" → re-plan (Phase 3A, Part 2): skips this block AND releases any
   *  other manually-pinned blocks today so the rest of the day can reflow around the change,
   *  rather than just relocating the one item that triggered it. */
  replanRemainingToday: (block: ScheduleBlock) => void;
  regenerateFrom: (dateOnly: string) => void;
  addCommitment: (input: Omit<Commitment, "id" | "userId">) => void;
  updateCommitment: (id: string, patch: Partial<Omit<Commitment, "id" | "userId">>) => void;
  removeCommitment: (id: string) => void;
  updatePlanningProfile: (patch: Partial<PlanningProfile>) => void;
  /** Marks first-time onboarding done (Phase 3B, Part 1/2) — never re-shown after this. */
  completeOnboarding: () => void;
  /** Sends the student back through onboarding on demand (e.g. Settings' "Redo setup"). Does not
   *  touch existing work items, commitments, or history — only the completion flag, so
   *  `OnboardingGate` redirects to `/onboarding` on the very next render. */
  resetOnboarding: () => void;
  submitFeedback: (feedback: Omit<ScheduleFeedback, "id" | "userId" | "createdAt">) => void;
  /** Starts a timed session on a scheduled block (Phase 3A, Part 4). */
  startSession: (block: ScheduleBlock) => void;
  /** Starts a timed session directly on a work item that isn't part of today's generated plan —
   *  used by the "work ahead" / "review" caught-up suggestions (Part 7). */
  startAdHocSession: (workItemId: string, workItemTitle: string, plannedMinutes?: number) => void;
  /** Abandons the in-progress session without recording it (e.g. the student changed their mind). */
  cancelActiveSession: () => void;
  /** Finishes the ad-hoc session started by `startAdHocSession`. */
  completeAdHocSession: (
    actualMinutes: number,
    estimateFeedback?: WorkSession["estimateFeedback"]
  ) => void;
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
  const [storageWarning, setStorageWarning] = useState(false);

  // Load saved state after mount. This has to run client-side — localStorage doesn't exist during
  // server rendering. A genuine first-ever visit (no saved data, and not just a parse failure)
  // starts completely empty and routes to onboarding — no fake sample data is created here
  // (Phase 3B, Part 11/23); a parse failure on corrupt data also falls back to empty rather than
  // silently discarding what might still be partially recoverable data by guessing.
  useEffect(() => {
    let next: AppState | null = null;
    let hadSavedData = false;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        hadSavedData = true;
        next = JSON.parse(raw) as AppState;
      }
    } catch {
      // Corrupt or inaccessible storage — fall through to a fresh empty state below.
    }
    if (next) {
      // Existing save (even one from before `onboardingComplete` existed) — never force onboarding.
      next.onboardingComplete = next.onboardingComplete ?? true;
      next.activeSession = next.activeSession ?? null;
      // Pre-Phase-4 saves have no `stages` array at all — every existing work item simply behaves
      // as a single-stage item until the student chooses to decompose it (Phase 4, Part 37).
      next.stages = next.stages ?? [];
    } else {
      next = {
        workItems: [],
        commitments: [],
        planningProfile: DEFAULT_PLANNING_PROFILE,
        fixedBlocks: [],
        workSessions: [],
        feedback: [],
        stages: [],
        activeSession: null,
        // A raw value that failed to parse (corrupt, not just absent) is treated as an existing
        // user with damaged data, not a first-timer — don't send someone who already had a plan
        // back through onboarding just because a save got corrupted.
        onboardingComplete: hadSavedData,
      };
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time load from an external store, not a derived-state loop
    setState(next);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // Syncing React state to an external system (localStorage) on every change, not a derived-
    // state loop — success/failure here can only be known after attempting the write itself.
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStorageWarning(false);
    } catch {
      // Storage full or unavailable (e.g. private browsing) — state still works for this session,
      // it just won't survive a reload. Surfaced via `storageWarning` (Phase 3B, Part 18) rather
      // than failing silently.
      setStorageWarning(true);
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

  const updateWorkItem = useCallback((id: string, patch: Partial<NewWorkItemInput>) => {
    setState((s) => ({
      ...s,
      workItems: s.workItems.map((item) =>
        item.id === id ? ({ ...item, ...patch, updatedAt: new Date().toISOString() } as SchedulableWorkItem) : item
      ),
    }));
  }, []);

  const removeWorkItem = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      workItems: s.workItems.filter((item) => item.id !== id),
      // Drop any historical (completed/skipped/manually-moved) blocks for the deleted item too —
      // an orphaned block referencing a work item that no longer exists would just be confusing.
      // Past WorkSessions are left alone; they're a record of time actually spent, not a live view.
      fixedBlocks: s.fixedBlocks.filter((b) => b.workItemId !== id),
      stages: s.stages.filter((stage) => stage.workItemId !== id),
      activeSession: s.activeSession?.workItemId === id ? null : s.activeSession,
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

  /** Accepts a proposed (or edited-before-accepting) stage breakdown for a work item (Phase 4,
   *  Part 9) — replaces any stages that item already had, so re-accepting after editing the draft
   *  doesn't leave stale stages behind. */
  const acceptDecomposition = useCallback((workItemId: string, stages: WorkStage[]) => {
    setState((s) => ({ ...s, stages: [...s.stages.filter((st) => st.workItemId !== workItemId), ...stages] }));
  }, []);

  /** "Keep as one task" (Phase 4, Part 9) — clears a decomposition; the item schedules as a single
   *  unit again, exactly as it did before Phase 4. */
  const clearStages = useCallback((workItemId: string) => {
    setState((s) => ({ ...s, stages: s.stages.filter((st) => st.workItemId !== workItemId) }));
  }, []);

  /** Edits one stage's name/duration, or its completion state (Phase 4, Part 10/13). A status
   *  change cascades to the parent work item's own status once every stage is complete, the same
   *  way `completeBlock` does for a stage finished via a scheduled session. */
  const updateStage = useCallback(
    (id: string, patch: Partial<Pick<WorkStage, "title" | "estimatedMinutes" | "status" | "actualMinutes">>) => {
      setState((s) => {
        const nextStages = s.stages.map((st) => (st.id === id ? { ...st, ...patch } : st));
        if (patch.status === undefined) return { ...s, stages: nextStages };

        const target = nextStages.find((st) => st.id === id);
        if (!target) return { ...s, stages: nextStages };
        const siblings = nextStages.filter((st) => st.workItemId === target.workItemId);
        const allStagesDone = siblings.length > 0 && siblings.every((st) => st.status === "completed");
        return {
          ...s,
          stages: nextStages,
          workItems: s.workItems.map((item) => {
            if (item.id !== target.workItemId) return item;
            const nextStatus = allStagesDone ? "completed" : item.status === "completed" ? "in-progress" : item.status;
            return { ...item, status: nextStatus, updatedAt: new Date().toISOString() };
          }),
        };
      });
    },
    []
  );

  /** Removes one stage from a plan and re-links the remaining ones so the dependency chain and
   *  ordering stay valid (Phase 4, Part 10) — never leaves a dangling `dependsOnStageId`. */
  const removeStage = useCallback((id: string) => {
    setState((s) => {
      const target = s.stages.find((st) => st.id === id);
      if (!target) return s;
      const others = s.stages.filter((st) => st.workItemId !== target.workItemId);
      const siblings = s.stages.filter((st) => st.workItemId === target.workItemId && st.id !== id);
      return { ...s, stages: [...others, ...renumberStages(siblings)] };
    });
  }, []);

  /** Adds a custom stage at the end of a work item's plan (Phase 4, Part 9/10). */
  const addStage = useCallback((workItemId: string, title: string, estimatedMinutes: number) => {
    setState((s) => {
      const siblings = s.stages.filter((st) => st.workItemId === workItemId);
      const others = s.stages.filter((st) => st.workItemId !== workItemId);
      const newStage: WorkStage = {
        id: newId(`${workItemId}_stage`),
        workItemId,
        title,
        stageType: "custom",
        order: siblings.length,
        estimatedMinutes,
        status: "not-started",
      };
      return { ...s, stages: [...others, ...renumberStages([...siblings, newStage])] };
    });
  }, []);

  const completeBlock = useCallback(
    (block: ScheduleBlock, actualMinutes: number, estimateFeedback?: WorkSession["estimateFeedback"]) => {
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
          estimateFeedback,
        };
        // A finished block's workItemId is either a real work item or, for a decomposed item, a
        // stage id (Phase 4) — the two cascade differently, so the stage case is handled first and
        // returns early rather than trying to make one code path cover both shapes.
        const stage = block.workItemId ? s.stages.find((st) => st.id === block.workItemId) : undefined;
        if (stage) {
          const newActual = (stage.actualMinutes ?? 0) + actualMinutes;
          const stageCompleted = newActual >= stage.estimatedMinutes;
          const nextStages = s.stages.map((st) =>
            st.id === stage.id
              ? { ...st, actualMinutes: newActual, status: (stageCompleted ? "completed" : "in-progress") as WorkStage["status"] }
              : st
          );
          const siblingStages = nextStages.filter((st) => st.workItemId === stage.workItemId);
          const allStagesDone = siblingStages.every((st) => st.status === "completed");
          return {
            ...s,
            fixedBlocks: [...s.fixedBlocks, { ...block, id: newId("done"), status: "completed" }],
            workSessions: [...s.workSessions, session],
            stages: nextStages,
            // The parent work item's own `actualMinutes` is left untouched — its progress is
            // tracked entirely through its stages (Part 14/26), never double-counted alongside them.
            workItems: s.workItems.map((item) =>
              item.id === stage.workItemId
                ? { ...item, status: allStagesDone ? "completed" : "in-progress", updatedAt: new Date().toISOString() }
                : item
            ),
            activeSession: s.activeSession?.blockId === block.id ? null : s.activeSession,
          };
        }

        return {
          ...s,
          // A fresh id, not `block.id`: the engine's block ids are deterministic (derived from
          // item/date/time), so a later regeneration that happens to land on the very same
          // item/date/time would otherwise collide with this historical record.
          fixedBlocks: [...s.fixedBlocks, { ...block, id: newId("done"), status: "completed" }],
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
          activeSession: s.activeSession?.blockId === block.id ? null : s.activeSession,
        };
      });
    },
    []
  );

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
        // See completeBlock: a fresh id avoids colliding with a future regenerated block that
        // happens to land on the same item/date/time this one originally occupied.
        fixedBlocks: [...s.fixedBlocks, { ...block, id: newId("skipped"), status: "skipped" }],
        workSessions: session ? [...s.workSessions, session] : s.workSessions,
        activeSession: s.activeSession?.blockId === block.id ? null : s.activeSession,
      };
    });
  }, []);

  const moveBlock = useCallback((block: ScheduleBlock, newStart: string, newEnd: string) => {
    setState((s) => ({
      ...s,
      fixedBlocks: [
        ...s.fixedBlocks,
        // Fresh id for the same reason as completeBlock/skipBlock — the moved block now lives at
        // a different date/time, but its old deterministic id remains available for the engine to
        // reuse on a future regeneration of the same item's original slot.
        { ...block, id: newId("moved"), start: newStart, end: newEnd, origin: "manual-override", status: "planned" },
      ],
    }));
  }, []);

  const replanRemainingToday = useCallback((block: ScheduleBlock) => {
    const dateOnly = block.start.slice(0, 10);
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
      // Release any other manually-pinned blocks today too, so the rest of the day is free to
      // reflow around the change rather than staying locked into slots planned before it.
      const releasedFixedBlocks = s.fixedBlocks.filter(
        (b) => !(b.origin === "manual-override" && b.status === "planned" && b.start.slice(0, 10) === dateOnly && b.id !== block.id)
      );
      return {
        ...s,
        fixedBlocks: [...releasedFixedBlocks, { ...block, id: newId("skipped"), status: "skipped" }],
        workSessions: session ? [...s.workSessions, session] : s.workSessions,
        activeSession: s.activeSession?.blockId === block.id ? null : s.activeSession,
      };
    });
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

  const updateCommitment = useCallback((id: string, patch: Partial<Omit<Commitment, "id" | "userId">>) => {
    setState((s) => ({
      ...s,
      commitments: s.commitments.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  }, []);

  const removeCommitment = useCallback((id: string) => {
    setState((s) => ({ ...s, commitments: s.commitments.filter((c) => c.id !== id) }));
  }, []);

  const startSession = useCallback((block: ScheduleBlock) => {
    if (!block.workItemId) return;
    setState((s) => ({
      ...s,
      activeSession: {
        blockId: block.id,
        workItemId: block.workItemId!,
        workItemTitle: block.title,
        plannedMinutes: minutesBetween(block.start, block.end),
        startedAt: new Date().toISOString(),
      },
    }));
  }, []);

  const startAdHocSession = useCallback((workItemId: string, workItemTitle: string, plannedMinutes?: number) => {
    setState((s) => ({
      ...s,
      activeSession: { workItemId, workItemTitle, plannedMinutes, startedAt: new Date().toISOString() },
    }));
  }, []);

  const cancelActiveSession = useCallback(() => {
    setState((s) => ({ ...s, activeSession: null }));
  }, []);

  const completeAdHocSession = useCallback(
    (actualMinutes: number, estimateFeedback?: WorkSession["estimateFeedback"]) => {
      setState((s) => {
        const active = s.activeSession;
        if (!active) return s;
        const now = new Date().toISOString();
        const session: WorkSession = {
          id: newId("session"),
          userId: DEMO_USER_ID,
          workItemId: active.workItemId,
          start: active.startedAt,
          end: now,
          plannedMinutes: active.plannedMinutes,
          minutesSpent: actualMinutes,
          estimateFeedback,
        };
        return {
          ...s,
          workSessions: [...s.workSessions, session],
          workItems: s.workItems.map((item) => {
            if (item.id !== active.workItemId) return item;
            const newActual = (item.actualMinutes ?? 0) + actualMinutes;
            return {
              ...item,
              actualMinutes: newActual,
              status: newActual >= item.estimatedMinutes ? "completed" : "in-progress",
              updatedAt: now,
            };
          }),
          activeSession: null,
        };
      });
    },
    []
  );

  const updatePlanningProfile = useCallback((patch: Partial<PlanningProfile>) => {
    setState((s) => ({ ...s, planningProfile: { ...s.planningProfile, ...patch } }));
  }, []);

  const completeOnboarding = useCallback(() => {
    setState((s) => ({ ...s, onboardingComplete: true }));
  }, []);

  const resetOnboarding = useCallback(() => {
    setState((s) => ({ ...s, onboardingComplete: false }));
  }, []);

  const submitFeedback = useCallback((feedback: Omit<ScheduleFeedback, "id" | "userId" | "createdAt">) => {
    setState((s) => {
      const nextFeedback = [
        ...s.feedback,
        { ...feedback, id: newId("feedback"), userId: DEMO_USER_ID, createdAt: new Date().toISOString() },
      ];
      // A bounded, deterministic nudge to the profile itself (Phase 3A, Part 9) — same
      // unanimous-streak-of-2 pattern as the daily-capacity feedback adjustment, just applied to
      // break preference and free-time priority instead of a numeric target.
      const nextBreakPreference = calculateBreakPreferenceAdjustment(nextFeedback, s.planningProfile.breakPreference);
      const nextFreeTimePriority = calculateFreeTimePriorityAdjustment(nextFeedback, s.planningProfile.freeTimePriority);
      return {
        ...s,
        feedback: nextFeedback,
        planningProfile: {
          ...s.planningProfile,
          breakPreference: nextBreakPreference,
          freeTimePriority: nextFreeTimePriority,
        },
      };
    });
  }, []);

  const value = useMemo<AppDataContextValue>(
    () => ({
      ...state,
      hydrated,
      storageWarning,
      addWorkItem,
      updateWorkItem,
      removeWorkItem,
      markWorkItemComplete,
      markWorkItemIncomplete,
      acceptDecomposition,
      clearStages,
      updateStage,
      removeStage,
      addStage,
      completeBlock,
      skipBlock,
      moveBlock,
      replanRemainingToday,
      regenerateFrom,
      addCommitment,
      updateCommitment,
      removeCommitment,
      updatePlanningProfile,
      completeOnboarding,
      resetOnboarding,
      submitFeedback,
      startSession,
      startAdHocSession,
      cancelActiveSession,
      completeAdHocSession,
    }),
    [
      state,
      hydrated,
      storageWarning,
      addWorkItem,
      updateWorkItem,
      removeWorkItem,
      markWorkItemComplete,
      markWorkItemIncomplete,
      acceptDecomposition,
      clearStages,
      updateStage,
      removeStage,
      addStage,
      completeBlock,
      skipBlock,
      moveBlock,
      replanRemainingToday,
      regenerateFrom,
      addCommitment,
      updateCommitment,
      removeCommitment,
      updatePlanningProfile,
      completeOnboarding,
      resetOnboarding,
      submitFeedback,
      startSession,
      startAdHocSession,
      cancelActiveSession,
      completeAdHocSession,
    ]
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

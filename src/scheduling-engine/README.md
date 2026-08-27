# Scheduling Engine

This directory is intentionally isolated from `src/app` and `src/components`.
It owns all logic for turning a student's workload (assignments, tests,
quizzes, projects) and commitments into a realistic schedule of
`ScheduleBlock`s.

## Why this is separate from the UI

The UI should only ever call functions exported from `src/scheduling-engine/index.ts`
and render the data it returns. It never contains scheduling logic itself (no
due-date math, no "how many minutes fit today" logic in a component). This keeps the
engine:

- Testable without rendering anything (see `__tests__/`)
- Reusable later from a mobile client or a background job
- Swappable — a smarter algorithm, or eventually the AI Coach, can call into this
  module without touching UI code. The Coach is explicitly out of scope through Phase 3A;
  the engine is shaped so a future Coach could call `generateSchedule`/`replanRemainingSchedule`
  the same way the UI does, rather than manipulating schedule state directly.

## Module map

| File | Responsibility |
| --- | --- |
| `constants.ts` | Every tunable number (priority weights, capacity baselines, session-length bounds), documented in place |
| `date-utils.ts` | Local-time date/time-of-day helpers (no timezone conversion) |
| `priority.ts` | `calculatePriority`, `calculateUrgency`, `explainPriority` — the scoring system in Part 3/15 of the Phase 2 spec |
| `capacity.ts` | `calculateDailyCapacity` — soft daily workload target, not a hard cap; `calculateFeedbackAdjustment`, `calculateBreakPreferenceAdjustment`, `calculateFreeTimePriorityAdjustment` — bounded nudges from recent schedule feedback |
| `availability.ts` | `findAvailableWindows`, `subtractIntervals` — free time windows from Planning Profile minus commitments minus existing blocks |
| `splitting.ts` | `splitTask` — carves remaining minutes into session-length chunks across day slots |
| `workload-status.ts` | `calculateWorkloadStatus` — ahead/on-track/getting-tight/at-risk, from the same demand/availability numbers `detectOverload` uses |
| `explanation.ts` | `explainScheduleDecision` — turns priority/urgency/session-count data the engine already has into a structured "why was this scheduled" breakdown (Phase 3B) |
| `schedule-diff.ts` | `diffSchedules` — compares two `ScheduleBlock[]` snapshots and reports only the work items whose footprint actually changed (Phase 3B) |
| `decomposition.ts` | `suggestStages`, `nextEligibleStage`, `isStageEligible`, `stageProgress`, `renumberStages` — turns a large project/essay/test-prep item into an ordered `WorkStage[]` and answers which single stage, if any, is eligible to be scheduled right now (Phase 4) |
| `scheduler.ts` | `generateSchedule`, `scheduleTask`, `detectOverload`, `replanRemainingSchedule` — orchestrates everything above |
| `index.ts` | The only module the UI should import from |

## Current status (Phase 2 + 2.5 + 3A + 3B + 4)

**Phase 4 additions:** `decomposition.ts` proposes a stage breakdown for large projects, essays, and
test/quiz prep (conservatively — routine homework/reading never qualify, see
`DECOMPOSITION_MIN_MINUTES`), with each stage's minutes rounded from a fixed per-workType template
and the rounding remainder absorbed by the last stage so stages always sum to exactly the item's
total (never `total + total`). Stages form a simple linear dependency chain; `generateSchedule`
never schedules a decomposed item as a whole — internally it substitutes the item for its single
next-eligible stage (`nextEligibleStage`) wherever a schedulable unit is needed, so priority,
capacity, splitting, and placement all reuse the exact same code path a plain item goes through.
Priority scores are stored under both the parent item's id and the active stage's id, so existing
per-item lookups (e.g. Dashboard's "coming up" ranking) keep working unchanged while
placement/explanation lookups (keyed by whatever id ended up on the actual block) also resolve.
`src/lib/next-best-action.ts` (outside this directory, deliberately not a second scheduler) reads a
`generateSchedule` result plus the active session and picks the single chronologically-next planned
work block to recommend — the engine already resolved priority/capacity conflicts when it decided
what to place and when, so the earliest remaining block doubles as the highest-priority
recommendation without any separate ranking logic.

**Phase 3B additions:** `explainScheduleDecision` builds a `ScheduleDecisionExplanation` (one-line
`primaryReason` reusing `explainPriority`, plus structured `bullets`: importance, deadline
strictness, remaining time, sessions planned, and a behind-schedule/fits-your-hours note) for every
item that actually got a block placed in a `generateSchedule` call — exposed as
`GenerateScheduleResult.decisionExplanations`, keyed by work item id. `diffSchedules` aggregates a
work item's session parts by total minutes and earliest date and compares two snapshots, reporting
only real changes (added/removed/moved/duration-changed) — deliberately approximate, not a full
diff of every chunk; used by the UI to show "schedule updated" summaries after replanning or a
schedule-relevant edit, without duplicating comparison logic in a component.

**Phase 3A additions:** `replanRemainingSchedule` (an explicitly-named wrapper making the "recompute
everything not fixed" behavior `generateSchedule` already had a first-class, documented concept —
see its docstring in `scheduler.ts`); a fix so a manually-moved-but-not-yet-completed block reduces
the item's remaining minutes (previously the engine could schedule the same work a second time
elsewhere after a manual move); test/quiz prep is now excluded from landing on the item's own due
date; an optional `preferredStartDate` hint narrows an item's schedulable window without touching
priority; `calculateWorkloadStatus` and the per-day `dailyForecast` on `GenerateScheduleResult`,
both grounded in the same numbers the engine already computes for overload detection;
`WorkAheadSuggestion.type` distinguishes "review" (tests/quizzes) from "work-ahead" (everything
else); `calculateBreakPreferenceAdjustment`/`calculateFreeTimePriorityAdjustment` apply the same
unanimous-streak-of-2 pattern as the capacity feedback adjustment to the Planning Profile's break
preference and free-time priority.

Implemented: priority scoring with a documented, adjustable weight system; a two-tier placement
order that protects near-deadline items (`URGENT_PROTECTION_HORIZON_DAYS`) from being crowded
out by higher-scoring-but-less-urgent work; availability from `PlanningProfile` + `Commitment`s;
a daily soft-capacity target driven by workload tolerance, course rigor, free-time priority,
whether the student is behind, and a bounded, deterministic adjustment from recent schedule
feedback (`calculateFeedbackAdjustment` — Phase 2.5 Part 11; no ML, just "two unanimous responses
in a row nudge the target, anything else is neutral"); task splitting across multiple sessions
bounded by break preference, with breaks reserved both between an item's own consecutive
sessions and between different items sharing a window; work-style-aware placement order (`early`
fills the soonest days, `deadline_driven` fills days closest to the due date first, `consistent`
spreads chunks evenly); caught-up detection with optional work-ahead suggestions (never
auto-scheduled); overload detection with a human-readable warning and a list of movable
(flexible/target) work; deterministic block ids (derived from inputs, not a counter or
`Math.random`).

Deliberately still a stub: `refineEstimate` (estimate-learning from historical accuracy) — the
engine only *records* the estimate-vs-actual data (`WorkSession.plannedMinutes`/`minutesSpent`)
that a future phase would need; it does not yet learn from it. No AI/LLM API is used or planned
for this module — see Part 24 of the Phase 2 spec.

## Known limitations (documented, not hidden)

- Availability comes only from `PlanningProfile.dailyAvailability`. There's no separate
  sleep/protected-time model — a day with no availability entry is simply unavailable.
- Daily capacity uses one target per day for the whole requested range (it doesn't vary the
  target day-to-day within a single `generateSchedule` call), which is a reasonable
  simplification but not a per-day-tuned optimum.
- Placement is a single greedy pass ordered by priority score, not a global optimizer — it can
  produce a good, explainable schedule, but not necessarily the mathematically optimal one.
- `calculateWorkloadStatus` and `dailyForecast` inherit the single-per-range daily capacity target
  above — they're an honest reflection of what the engine actually computed for that call, not an
  independently-tuned "true" forecast.
- A decomposed item only ever contributes its *active* stage's minutes to demand/capacity/forecast
  numbers — later stages in the chain aren't reserved for in advance. This matches the spec's
  worked examples (complete a stage → the next one becomes schedulable on the next call) but means
  a student who completes stages very close to the item's deadline may find the remaining stages
  compressed into less time than an up-front, whole-item plan would have reserved.

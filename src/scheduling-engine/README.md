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
  module without touching UI code. The Coach is explicitly out of scope for Phase 2;
  the engine is shaped so a future Coach could call `generateSchedule`/`replan` the
  same way the UI does, rather than manipulating schedule state directly.

## Module map

| File | Responsibility |
| --- | --- |
| `constants.ts` | Every tunable number (priority weights, capacity baselines, session-length bounds), documented in place |
| `date-utils.ts` | Local-time date/time-of-day helpers (no timezone conversion) |
| `priority.ts` | `calculatePriority`, `calculateUrgency`, `explainPriority` — the scoring system in Part 3/15 of the Phase 2 spec |
| `capacity.ts` | `calculateDailyCapacity` — soft daily workload target, not a hard cap; `calculateFeedbackAdjustment` — bounded nudge from recent schedule feedback |
| `availability.ts` | `findAvailableWindows` — free time windows from Planning Profile minus commitments minus existing blocks |
| `splitting.ts` | `splitTask` — carves remaining minutes into session-length chunks across day slots |
| `scheduler.ts` | `generateSchedule`, `scheduleTask`, `detectOverload`, `replan` — orchestrates everything above |
| `index.ts` | The only module the UI should import from |

## Current status (Phase 2 + 2.5)

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

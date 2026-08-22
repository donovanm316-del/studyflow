# Scheduling Engine

This directory is intentionally isolated from `src/app` and `src/components`.
It owns all logic for turning a student's workload (assignments, tests,
quizzes, projects) and commitments into a realistic schedule of
`ScheduleBlock`s.

## Why this is separate from the UI

The UI should only ever call functions exported from `src/scheduling-engine/index.ts`
and render the `ScheduleBlock[]` / insight objects it returns. It should never
contain scheduling logic itself (no due-date math, no "how many minutes fit
today" logic in a component). This keeps the engine:

- Testable without rendering anything
- Reusable later from a mobile client or a background job
- Swappable — a smarter algorithm, or eventually the AI Coach, can replace or
  call into this module without touching UI code

## Planned responsibilities (not yet implemented)

- **Workload estimation**: turn a raw assignment/test/project into an
  estimated-minutes figure, refined over time using `WorkSession` history.
- **Availability calculation**: given a `PlanningProfile` and a set of
  `Commitment`s, compute the free time windows in a day/week.
- **Block placement**: assign work items into free windows, respecting due
  dates, buffer days, and preferred session length.
- **Replanning**: when a student misses a session or a due date changes,
  recompute affected blocks without discarding unrelated ones.
- **Insight generation**: summarize estimate-vs-actual accuracy and workload
  trends for the Insights page.

## Current status

Phase 1A ships only the module skeleton and type contracts in `types.ts` and
`index.ts`. Every exported function currently throws `Not implemented yet`.
No scheduling algorithm exists yet — this is deliberate scope control, not an
oversight. Implementing it is Phase 1B+ work.

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
| `deadline-capacity.ts` | `calculateAvailableMinutesBeforeDeadline`, `calculateDeadlineCapacity` — how much *usable* work time genuinely remains before an exact deadline, and whether the remaining work still fits (Phase 4.5A) |
| `estimation.ts` | `buildEstimateHistory`, `personalizeEstimate` — "how long does THIS student usually need for THIS kind of work?", from their own recorded sessions (Phase 4.5C) |
| `scheduler.ts` | `generateSchedule`, `scheduleTask`, `detectOverload`, `replanRemainingSchedule` — orchestrates everything above |
| `index.ts` | The only module the UI should import from |

## Current status (Phase 2 + 2.5 + 3A + 3B + 4 + 4.5A + 4.5B + 4.5C + 4.5D)

**Phase 4.5D — foundation lock.** Three engine-visible changes:

1. `WorkItemBase.usePersonalizedEstimate` lets a student opt one item out of history-based
   adjustment; `personalizeEstimate` returns early when it's `false`. Undefined means enabled, so
   every existing item behaves exactly as it did in 4.5C. History still accumulates either way,
   which is what makes the choice reversible.
2. `GenerateScheduleResult.freeMinutesRemainingToday` reports genuinely unclaimed time — real
   availability from *now* to end of day, minus commitments, minus work still ahead. The UI
   previously derived this from `dailyForecast.availableMinutes`, which is capped at the daily
   capacity *target*; subtracting work from that yields leftover **capacity**, and it told a student
   with five hours of evening left that they had ninety minutes free.
3. `source` / `externalId` / `externalUrl` exist on work items for a future import, and the engine
   reads **none** of them. A scenario test asserts an imported item schedules byte-identically to a
   manual one — that guarantee is the whole point of the field, and the boundary that would use it
   lives in `src/lib/data/import.ts` (definitions and merge rules only; no integration).

**Phase 4.5C — personalized estimates.** `estimation.ts` implements what `refineEstimate` had been
a documented stub for since Phase 2. It is statistical, not learned: take the median
actual÷estimated ratio from the student's most recent similar sessions, damp it by how much history
backs it, clamp it to [0.8, 1.5], and multiply their own estimate by the result. Median resists a
single brutal night; the recency window lets a student who improves stop being judged on how they
started; the damping means three samples move the schedule half as far as twenty.

Similarity falls back outward — work type + rigor + subject → type + rigor → type → overall — taking
the most specific category that clears the minimum sample count, so a confident number is never
produced from one or two sessions. Sessions whose work item was since deleted still count toward
overall accuracy, since the estimate/actual pair is real; they just can't be categorized.

Personalization is applied at the single point where schedulable units are resolved, so one planning
figure flows into placement, priority, deadline capacity, buffer and the forecast — they cannot
disagree. The student's own estimate is never overwritten: `estimateAdjustments` carries both
numbers, and the UI shows the student's alongside what the engine planned with, plus why. Note that
the *reason text reports the observed median* while the *planner applies the damped ratio* — that
gap is deliberate (the planner is conservative), and stating the damped figure as if it were the
student's record would be a false claim, so the two are kept distinct on purpose.

**Phase 4.5B — decision support (lives in `src/lib/decision-support.ts`, not here).** Everything
that answers "what should I do now / what if I don't / what fits in 30 minutes / is my week
manageable" either reads a `GenerateScheduleResult` this engine already produced, or re-runs
`generateSchedule` over a hypothetical, never-persisted copy of its inputs. There is still exactly
one scheduler. The "what if I move this?" preview shares its block-list transformation with the
store via `src/lib/schedule-mutations.ts`, so the preview and the real action cannot drift apart.

One engine change came out of it: `deadlineCapacities` now measures **work still to be done**
(`estimated - actual`) against usable time before the deadline, excluding commitments and *other*
items' blocks but not the item's own. Previously it reused the placement pass's `remainingOf`,
which nets off minutes already pinned to a manual override — correct for deciding what still needs
placing, but wrong for "will I make this deadline?", because pinning a session made the work appear
to shrink and the buffer to *grow*. Capacities are now also computed for every in-range item rather
than only those with unplaced work, so a fully-pinned item still reports a real deadline picture.

**Phase 4.5A additions — exact deadline times.** Deadlines are full `YYYY-MM-DDTHH:mm` timestamps
end to end. `normalizeDeadline` coerces any legacy date-only value to 11:59 PM that day (the end of
the day it was due — never midnight, which would silently make it a day more urgent), and is
applied on load in the store plus defensively wherever the engine reads a deadline, so old saves
keep working untouched.

`calculateUrgency` now decays hyperbolically (`1 / (1 + daysLeft / URGENCY_HALF_LIFE_DAYS)`)
against the exact timestamp rather than linearly over a 10-day horizon. The old curve was nearly
flat across the final two days — "due tonight" and "due tomorrow night" scored 0.975 vs 0.875, a
difference of 0.028 once weighted, which is precisely the distinction that matters most. The new
curve gives that pair 0.89 vs 0.62 while still ranking far-off work well below near work. Every
other priority factor (weight, strictness, workload, type, overdue) is unchanged, as is the
`URGENT_PROTECTION_HORIZON_DAYS` near-deadline protection.

`deadline-capacity.ts` answers "is there actually time for this?" honestly: it walks real
availability windows minus commitments minus existing blocks between now and the deadline, clipping
the first day at the current time and the last at the deadline instant — so a task due in 14
wall-clock hours overnight correctly reports far less than 14 hours of capacity. Results surface as
`GenerateScheduleResult.deadlineCapacities` (buffer/shortfall plus a four-level risk read), feed the
"why today?" explanations, and raise a `deadline-at-risk` warning for hard/important items whose
work no longer fits — which is what makes a risky manual move visible instead of silently fine.

Placement gained a per-item `deadlineCap`: no session may run past the deadline instant. For
tests/quizzes this replaces the blunt Phase 3A rule *only when the student actually gave an exam
time* — an unspecified deadline still defaults to 23:59, which is an absence of information rather
than a claim about the exam, so the whole exam day stays excluded in that case. With a real time, a
9:00 AM exam leaves only that morning's window and a 3:00 PM one leaves considerably more.

## Previous status (Phase 2 + 2.5 + 3A + 3B + 4)

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

Previously-stubbed work now implemented: `refineEstimate` (Phase 4.5C) — see `estimation.ts`.
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
- Deadlines are interpreted in the browser's local time with no timezone model (Phase 4.5A) —
  consistent for one student on one device, but a deadline does not travel across timezones.
- `deadlineCapacities` measures available time against the blocks that existed *before* this
  placement pass, and excludes the item's own blocks, so it answers "is there room for this work?"
  rather than "is there room left after scheduling it?" — the two would otherwise make every
  scheduled item look starved. A consequence: capacity alone cannot see a session pinned *past* its
  own deadline (the time before the deadline is unchanged), so `previewMove` additionally compares
  work needed against minutes the engine actually placed before the deadline.
- A decomposed item only ever contributes its *active* stage's minutes to demand/capacity/forecast
  numbers — later stages in the chain aren't reserved for in advance. This matches the spec's
  worked examples (complete a stage → the next one becomes schedulable on the next call) but means
  a student who completes stages very close to the item's deadline may find the remaining stages
  compressed into less time than an up-front, whole-item plan would have reserved.

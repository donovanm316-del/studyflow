# StudyFlow

A time-management planner for students. StudyFlow takes what a student actually has to do —
assignments, tests, projects, and the fixed commitments already filling their week — and builds a
realistic day-by-day schedule from it, explaining every decision it makes.

The scheduling is **deterministic and rule-based**. There is no AI, no LLM, and no machine learning
anywhere in it: given the same inputs it produces the same schedule, and every recommendation can
be traced to a rule you can read in `src/scheduling-engine/`.

## Getting started

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

No configuration, accounts, or API keys are needed. Data is stored in the browser's
`localStorage`; there is no backend and no database.

```bash
npm test          # vitest
npm run lint      # eslint
npx tsc --noEmit  # typecheck
npm run build     # production build
```

## What it does

- **Scheduling** — daily and weekly plans built around real availability and fixed commitments
- **Exact deadlines** — full date *and* time, with urgency that responds to hours, not just days
- **Deadline capacity** — how much usable work time genuinely remains before each due date, and the
  buffer or shortfall that follows from it
- **Task decomposition** — large projects broken into ordered stages the scheduler places
  individually
- **Next Best Action** — one recommendation for what to do now, sourced from the real schedule
- **Decision support** — why this, what happens if you skip it, what fits in thirty minutes
- **Personalized estimates** — planning durations adjusted from the student's own logged sessions,
  by median ratio; statistical, not learned, and switchable off per item
- **Insights** — per-subject accuracy and workload patterns drawn from recorded history
- **Replanning** — a schedule that adapts when a day goes sideways, with the changes explained

## Architecture

| | |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Styling | Tailwind CSS |
| Storage | Browser `localStorage` |
| Testing | Vitest |
| Hosting | Vercel |

```
src/
  app/                     routes, plus the Google Classroom API route handlers
  components/              UI
  lib/                     application logic (store, decision support, insights, import boundary)
  lib/integrations/        external data sources
  scheduling-engine/       the deterministic planner — no React, no I/O, no globals
  types/                   domain models
```

The scheduling engine is the single source of truth for scheduling. Everything that recommends,
explains, or previews a change reads its output or re-runs it — nothing computes a schedule of its
own. `src/scheduling-engine/README.md` describes how it works.

## Google Classroom

StudyFlow can connect to Google Classroom to read a student's class list, read-only. The connection
needs Google Cloud credentials that aren't part of this repository, and **the app runs normally
without them** — Settings simply reports that Google Classroom isn't set up.

Setup instructions, the OAuth scopes requested and why, and how credentials are handled:
[`docs/google-classroom-setup.md`](docs/google-classroom-setup.md).

Importing assignments from Classroom is not built yet.

## Deployment

Deployed on Vercel from the default branch. The build requires no environment variables; the
Google Classroom variables are optional and only enable that connection.

# Google Classroom setup

StudyFlow can connect to Google Classroom to read the list of classes a student is enrolled in.
The connection requires Google Cloud credentials that **cannot be committed to this repository** —
each developer and each deployment supplies their own.

Without them, StudyFlow runs completely normally. Settings shows "Google Classroom — Not set up"
along with the names of the missing variables, and nothing else in the app is affected. You do not
need to complete any of this to work on StudyFlow.

---

## StudyFlow does not modify Google Classroom

Nothing StudyFlow does changes anything in Classroom. Marking work complete in StudyFlow does not
submit it, turn it in, or alter its status in Classroom — the two are separate systems, and
StudyFlow only ever reads.

| | |
|---|---|
| **Can** | Read the classes the signed-in student is enrolled in |
| **Can** | Read those classes' coursework — title, description, due date and time, and the Classroom link |
| **Cannot** | Create, edit, submit, turn in, or delete anything in Google Classroom |
| **Cannot** | See other students' work, rosters, grades, or announcements |
| **Cannot** | See whether the student has turned work in — that scope is not requested |
| **Cannot** | See the student's name or email — no identity scope is requested |

Read-only is enforced twice over: by the OAuth scopes Google grants, and by the client code, which
has no code path that issues anything other than a `GET` to the Classroom API. A test asserts that
no `POST`, `PUT`, `PATCH`, or `DELETE` appears in the Classroom client.

## Scopes requested

```
https://www.googleapis.com/auth/classroom.courses.readonly
https://www.googleapis.com/auth/classroom.coursework.me.readonly
```

That is the entire list. Both are read-only, both are used by code that exists: the first for the
class list, the second for the coursework import. StudyFlow holds no permission no code uses.

`include_granted_scopes=true` (Google's incremental authorization) is set on the authorization
request, so a student who connected under an earlier version is asked only for the new permission
rather than re-consenting to everything.

Deliberately never requested:

- `classroom.courses`, `classroom.coursework.me` — the non-`.readonly` forms, which grant **write**
  access.
- anything ending in `.students`, plus `.rosters`, `.announcements`, `.profile.emails` — these
  expose other people's data and exist for teacher and administrator tools.
- `classroom.student-submissions.me.readonly` — this would reveal whether the student has turned
  work in. It is not requested, and the consequence is accepted rather than worked around: StudyFlow
  never reads Classroom submission state, and its own completion status is what governs planning.

---

## One-time Google Cloud configuration

### 1. Create a project

[Google Cloud Console](https://console.cloud.google.com/) → project picker → **New Project**.

### 2. Enable the Classroom API

**APIs & Services → Library** → search "Google Classroom API" → **Enable**.

### 3. Configure the OAuth consent screen

**APIs & Services → OAuth consent screen**.

- **User type**: *External*, unless everyone using it is in your Google Workspace organization.
- Fill in the app name, support email, and developer contact email.
- Add both scopes: `https://www.googleapis.com/auth/classroom.courses.readonly` and
  `https://www.googleapis.com/auth/classroom.coursework.me.readonly`.
- While the app is in **Testing**, add every Google account you intend to sign in with under
  **Test users**. An account that isn't listed will be refused at the consent screen.

Classroom scopes are *sensitive*, so publishing the app to real users requires Google's OAuth
verification review. Testing mode is sufficient for development and is limited to 100 test users.

### 4. Create the OAuth client

**APIs & Services → Credentials → Create Credentials → OAuth client ID** → **Web application**.

Add every redirect URI you will use under **Authorized redirect URIs**. Google matches these
literally — scheme, host, port, path, and trailing slash all have to be identical:

```
http://localhost:3000/api/integrations/google-classroom/callback
https://<your-production-domain>/api/integrations/google-classroom/callback
```

If you also want to test Vercel preview deployments, note that their URLs change per deployment;
add a stable preview domain rather than trying to register each one.

Copy the **Client ID** and **Client secret**.

---

## Environment variables

Copy `.env.example` to `.env.local` and fill it in:

```bash
cp .env.example .env.local
```

| Variable | What it is |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client ID from step 4 |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret from step 4. Server-side only. |
| `GOOGLE_REDIRECT_URI` | The callback URL registered in step 4, for this environment |
| `STUDYFLOW_SESSION_SECRET` | ≥32 random characters, used to encrypt the connection cookie |

Generate the session secret with:

```bash
openssl rand -base64 48
```

**Never prefix any of these with `NEXT_PUBLIC_`.** Next.js inlines `NEXT_PUBLIC_*` variables into
the browser bundle, which would publish the client secret to every visitor.

### Local development

`GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/google-classroom/callback`

Google permits `http://localhost` redirect URIs; it does not permit plain HTTP anywhere else.

### Vercel

Add all four variables under **Project → Settings → Environment Variables**, then redeploy —
Vercel only injects environment variables at build/run time, so an existing deployment will not
pick them up. Set `GOOGLE_REDIRECT_URI` to your production domain's callback URL and register that
exact URL in the Google Cloud console.

---

## How credentials are handled

- The client secret and session secret are read **only** in server-side modules
  (`config.ts`, `oauth.ts`, `session.ts`, `service.ts`) and in API route handlers. No React
  component imports them; the integration's `index.ts` barrel deliberately does not re-export them,
  so a stray import cannot pull them into the client bundle.
- The Google **refresh token** is encrypted with AES-256-GCM and stored in an `httpOnly`, `Secure`,
  `SameSite=Lax` cookie. JavaScript in the browser cannot read it, and only the server — which
  holds `STUDYFLOW_SESSION_SECRET` — can decrypt it.
- **Access tokens are never stored anywhere.** One is minted per Classroom request and discarded.
- **No token ever touches `localStorage`.** StudyFlow's `localStorage` holds only the student's own
  planning data, exactly as it did before this phase.
- Google's error responses are never forwarded to the browser. Every failure is mapped to a fixed
  code with pre-written copy before it leaves the server.

Rotating `STUDYFLOW_SESSION_SECRET` invalidates existing connection cookies, so everyone is shown
as disconnected and reconnects with one click. No StudyFlow data is affected.

---

## Testing the connection

1. `npm run dev`
2. Open <http://localhost:3000/settings>
3. **Connect Google Classroom** → sign in with a Google account listed as a test user → grant access
4. Settings should show **Connected**
5. **Check connection** makes a real API call and reports how many classes were found
6. **Sync now** retrieves coursework and opens the review screen

If the account has no Classroom classes, the check honestly reports that none were found rather
than showing a fabricated list.

---

# How import and sync work

## The flow

```
Google Classroom → read-only API → normalization → reconciliation → review → StudyFlow work items
                                                                              → existing scheduler
```

Classroom is a **source of coursework**. It never makes scheduling decisions. Imported assignments
become ordinary StudyFlow work items and go through exactly the same engine as hand-entered ones —
same priority scoring, deadline capacity, splitting, decomposition, personalized estimates,
commitments, capacity limits, and free-time protection. There is no Classroom-specific scheduler,
and a test asserts an imported item schedules identically to a manually created one.

## Nothing is imported without review

**Sync now** retrieves coursework and shows what it found, sorted into:

| Group | Meaning | Selected by default |
|---|---|---|
| **New** | Not in StudyFlow yet, with a Classroom deadline | Yes |
| **No deadline in Classroom** | Real work, but Classroom gave no due date | No — needs a date first |
| **Changed in Classroom** | Already imported; a teacher changed something | No — shown before / after |
| **No longer in Google Classroom** | Already imported; Classroom didn't return it | Informational only |
| Already imported and unchanged | Nothing to do | — |

Nothing is written until **Import** is pressed. Individual items can be skipped, and **Select all**
is available per group.

## What is preserved from Classroom

Coursework id, course id, title, description, course name and section, coursework type, publication
state, creation and update timestamps, due date, due time, and the Classroom link.

Only three of those are persisted onto the work item as a **sync baseline**: title, due date, and
course name. That is the minimum reconciliation needs. StudyFlow does not keep a copy of Classroom's
API response.

## What StudyFlow infers, and what it refuses to

**Infers:**

- The **deadline instant**, by converting Classroom's UTC due date and time into local time.
- That an item is the **same** item as one already imported, from provider + course id + coursework
  id.
- That an item is a **plain assignment**.

**Refuses to infer:**

- **How long anything takes.** Classroom does not say, so StudyFlow does not guess. Imported work
  arrives with a placeholder duration and is flagged *estimate needed* until the student sets one.
  The placeholder exists because the scheduler needs a number; the flag is what stops that number
  from being mistaken for a real estimate. Once real sessions exist, the existing personalized-
  estimate system takes over — and it never overwrites the student's own number.
- **What kind of academic work it is.** Classroom's `ASSIGNMENT` covers both a ten-minute worksheet
  and a three-week project. Nothing is classified as a test, quiz, essay, project, or reading on
  import, and there is no title-keyword rule: "Unit 5 Test Review" is revision, not a test, and
  getting that wrong would mis-schedule a student's exam prep. The student changes the type in one
  click if it matters.
- **Importance or deadline strictness** beyond a neutral default.
- **A deadline that doesn't exist** — see below.

No AI, no LLM, no external classification service is involved in any of this. Every decision is
deterministic and testable.

## Deadlines

Classroom supplies `dueDate` and `dueTime` in **UTC**.

- **Date + time** → converted to the exact local instant and preserved. A 3:00 PM deadline stays
  3:00 PM; it is never rounded to 11:59 PM. This legitimately shifts the calendar date across time
  zones, which is the correct answer, not a bug.
- **Date only** → passed through as a bare date, and StudyFlow's existing `normalizeDeadline()`
  applies its usual end-of-day convention. No time is invented at the Classroom boundary.
- **Neither** → the item is **not** imported until the student gives it a target date. Defaulting it
  to "today at 11:59 PM" would inject fabricated urgency into a real week. A student-chosen date is
  recorded as a **target**, not a hard deadline, because the teacher didn't set it.

## Duplicate detection

Identity is **provider + course id + coursework id** — never the title. A teacher renaming
"Chapter 7 Reading" to "Chapter 7 Reading — Updated" does not create a second item. Syncing
repeatedly produces the same one work item, and an item already imported is never offered as new
again — including after the student has completed it.

If a student already created something by hand with a matching title, StudyFlow **warns and lets
them decide**: "You may already have this in StudyFlow as …". It never silently merges or deletes
their own work, because it has no way to know the two are the same assignment and the student does.

## Synchronization

Change detection compares incoming Classroom data against the stored **baseline**, not against the
item's current values. This matters: a student who renames their own copy of an assignment must not
have it renamed back on every sync, while a genuine teacher change on that same item must still be
caught. Both cases are tested.

When a teacher moves a deadline, the review screen shows it plainly — *Friday at 11:59 PM →
Thursday at 3:00 PM* — and accepting it re-runs the existing engine. The schedule changes shown
afterwards are real engine output from the existing schedule diff, not composed text.

Only the fields Classroom owns are ever updated: **title, due date, class, and link**. Estimates,
importance, deadline strictness, preferred start date, personalization preference, status, logged
time, stage breakdowns, and work sessions are the student's and are never touched.

Coursework that disappears from Classroom is **reported, never deleted** — the student may have
already done it, and their sessions and history are theirs. An item is only reported as missing if
its course was actually read successfully this run, so one failing class never reports its whole
workload as gone.

## Coursework state policy

| Classroom state | StudyFlow behavior |
|---|---|
| `PUBLISHED` | Importable |
| `DRAFT` | Excluded (Classroom does not return drafts to students anyway) |
| `DELETED` | Excluded from import; if previously imported, reported as no longer in Classroom |
| Turned in / returned / graded | **Not read.** Requires a scope StudyFlow does not request. |

Completed work is never resurrected: an item StudyFlow has already imported is matched by external
identity and never re-offered as new, whatever its status.

## Course selection

The student chooses which active classes to sync, and the choice is saved with their data — it
survives reloads, and it survives disconnecting and reconnecting. An empty selection means *all
active courses*, which is where a newly-connected student starts. It can be changed at any time from
the sync screen.

## Performance

Syncing is manual. There is no background polling and no automatic refresh. One sync fetches the
course list once and then one page-set of coursework per selected course, following pagination and
stopping at a hard page cap so a misbehaving `nextPageToken` cannot spin forever.

---

## Disconnecting

**Disconnect** revokes the token at Google and deletes the cookie. It does **not** change anything
in Google Classroom, and it does **not** delete any StudyFlow assignments, sessions, or history —
including work originally imported from Classroom. Once imported, that work is the student's, with
their estimates and their logged time on it. Disconnecting a source stops new data arriving; it does
not reach into a student's planner and remove their work.

The saved course selection is kept too, so reconnecting doesn't start from scratch.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Settings says "Not set up" | One or more variables missing from `.env.local`; the card lists which. Restart the dev server after editing it. |
| `redirect_uri_mismatch` from Google | `GOOGLE_REDIRECT_URI` doesn't exactly match a registered URI. Compare character by character. |
| "StudyFlow hasn't completed the Google verification process" | Expected while the consent screen is in Testing. Add the account under **Test users**. |
| "Google rejected this copy of StudyFlow's credentials" | Wrong client ID or secret, or the OAuth client was deleted. |
| "Your Google authorization has expired or was removed" | The grant was revoked at [myaccount.google.com/permissions](https://myaccount.google.com/permissions). Reconnect. |
| Connection works, then fails an hour later | Google returned no refresh token. StudyFlow forces `prompt=consent` to prevent this; if it recurs, check that the authorization URL still carries `access_type=offline`. |

---

## What is not built yet

Not included: background or automatic synchronization, push notifications, Google Calendar, any
write access to Classroom, automatic classification of coursework type, workload estimation from
descriptions, AI of any kind, real accounts or a backend database, and a mobile app.

Syncing is a manual action the student takes.

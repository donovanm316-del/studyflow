# Google Classroom setup

StudyFlow can connect to Google Classroom to read the list of classes a student is enrolled in.
The connection requires Google Cloud credentials that **cannot be committed to this repository** —
each developer and each deployment supplies their own.

Without them, StudyFlow runs completely normally. Settings shows "Google Classroom — Not set up"
along with the names of the missing variables, and nothing else in the app is affected. You do not
need to complete any of this to work on StudyFlow.

---

## What the connection can and cannot do

| | |
|---|---|
| **Can** | Read the list of Google Classroom classes the signed-in student is enrolled in |
| **Cannot** | Create, edit, submit, or delete anything in Google Classroom |
| **Cannot** | See other students' work, rosters, grades, or announcements |
| **Cannot** | Read coursework or assignments — that scope is not requested (Phase 5B) |
| **Cannot** | See the student's name or email — no identity scope is requested |

Read-only is enforced twice over: by the OAuth scope Google grants, and by the client code, which
has no code path that issues anything other than a `GET` to the Classroom API.

## Scopes requested

```
https://www.googleapis.com/auth/classroom.courses.readonly
```

That is the entire list. Phase 5A retrieves classes and nothing else, so it asks for exactly the
permission that allows it.

`classroom.coursework.me.readonly` is **not** requested yet, even though Phase 5B will need it, on
the principle that an app should not hold a permission no code uses. The authorization request sets
`include_granted_scopes=true` (Google's incremental authorization), so when the coursework scope is
added later the student is asked only for the new permission and this grant carries forward.

Deliberately never requested: `classroom.courses` (write access), and anything ending in
`.students`, `.rosters`, `.announcements`, or `.student-submissions.students` — those grant a view
of other people's data and exist for teacher and administrator tools.

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
- Add the scope `https://www.googleapis.com/auth/classroom.courses.readonly`.
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

If the account has no Classroom classes, the check honestly reports that none were found rather
than showing a fabricated list.

### Disconnecting

**Disconnect** revokes the token at Google and deletes the cookie. It does **not** change anything
in Google Classroom, and it does **not** delete any StudyFlow assignments, sessions, or history —
including, once Phase 5B exists, work that was originally imported from Classroom. Disconnecting a
source stops new data arriving; it does not reach into a student's planner and remove their work.

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

Phase 5A is the connection foundation only. It does **not** include importing assignments,
synchronizing them, detecting duplicates, converting coursework into StudyFlow work items, Google
Calendar, any write access to Classroom, AI, a backend database, or a mobile app. Assignment import
is Phase 5B.

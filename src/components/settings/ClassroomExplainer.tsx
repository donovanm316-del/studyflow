/**
 * "What does StudyFlow get from Google Classroom, and how do I connect it?" (Phase 6A, Part 1/2).
 *
 * A native `<details>`/`<summary>` disclosure — no client state needed, keyboard-operable and
 * screen-reader-friendly for free. Collapsed by default so it doesn't crowd the card for a student
 * who already knows how this works; one click away for a student who's never seen it before.
 *
 * Content lives here, not in `docs/google-classroom-setup.md` — that file is a deployer's setup
 * guide (Google Cloud credentials, redirect URIs); this is the *student-facing* explanation, and
 * the two audiences shouldn't share one document.
 */
export function ClassroomExplainer() {
  return (
    <details className="group mt-2 rounded-md border border-border">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-brand-strong marker:content-none hover:bg-paper">
        What does StudyFlow get from Google Classroom, and how do I connect it?
      </summary>
      <div className="flex flex-col gap-4 border-t border-border px-3 py-3 text-xs text-ink-muted">
        <div>
          <p className="mb-1 font-medium text-ink">What StudyFlow gets</p>
          <ul className="list-disc pl-4">
            <li>Your enrolled classes</li>
            <li>Assignment titles</li>
            <li>Due dates and times, when your teacher sets them</li>
            <li>Assignment descriptions, when your teacher included one</li>
            <li>A link back to the assignment in Google Classroom</li>
          </ul>
        </div>

        <div>
          <p className="mb-1 font-medium text-ink">What StudyFlow does not get or do</p>
          <ul className="list-disc pl-4">
            <li>Cannot change, complete, or submit your assignments</li>
            <li>Cannot post comments</li>
            <li>Cannot see or change grades</li>
            <li>Cannot modify anything in Google Classroom</li>
            <li>Cannot access teacher tools</li>
            <li>Cannot see other students&apos; information</li>
          </ul>
        </div>

        <div>
          <p className="mb-1 font-medium text-ink">Connect Google Classroom</p>
          <ol className="flex flex-col gap-2">
            <li>
              <span className="font-medium text-ink">1. Select &ldquo;Connect Google Classroom&rdquo;</span>
              <p>StudyFlow will send you to Google&apos;s own secure sign-in page.</p>
            </li>
            <li>
              <span className="font-medium text-ink">2. Choose your school Google account</span>
              <p>Use the same account you use for Google Classroom.</p>
            </li>
            <li>
              <span className="font-medium text-ink">3. Allow read-only access</span>
              <p>StudyFlow only asks for permission to read your classes and schoolwork.</p>
            </li>
            <li>
              <span className="font-medium text-ink">4. Return to StudyFlow</span>
              <p>You&apos;ll land back in Settings, connected — pick which classes StudyFlow should use next.</p>
            </li>
          </ol>
        </div>
      </div>
    </details>
  );
}

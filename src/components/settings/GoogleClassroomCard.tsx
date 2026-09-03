"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ClassroomSyncModal } from "@/components/settings/ClassroomSyncModal";
import { ClassroomCourseManager } from "@/components/settings/ClassroomCourseManager";
import { ClassroomExplainer } from "@/components/settings/ClassroomExplainer";
import { ScheduleChangeNotice } from "@/components/schedule/ScheduleChangeNotice";
import { formatSyncRecency } from "@/lib/data/classroom-sync";
import { useAppData } from "@/lib/data/store";
import { classroomErrorMessage, type ClassroomConnectionStatus, type ClassroomErrorCode } from "@/lib/integrations/google-classroom";
import type { ScheduleChangeSummary } from "@/scheduling-engine";

/**
 * The Google Classroom connection, in Settings.
 *
 * This component contains no Google URLs, no scope strings and no tokens — it calls StudyFlow's own
 * API routes and renders what they return. That's the boundary the phase is really about: the
 * browser never talks to Google's API directly, so nothing sensitive can end up in client
 * JavaScript.
 *
 * The states it can show are: still loading, not configured (this deployment has no Google
 * credentials), not connected, connecting, connected, needs reconnecting (the authorization Google
 * holds went away), and failed. "Not configured" and "needs reconnecting" are both real states with
 * real copy rather than a generic error banner, because what the student should do next is
 * different in each case.
 */

const API = "/api/integrations/google-classroom";

/** The error shape the routes return. Deliberately narrow — a code and vetted copy, nothing else. */
interface ApiError {
  error?: ClassroomErrorCode;
  message?: string;
}

/** Codes that mean the *authorization* itself is gone, not a transient failure — see Part 9. */
const RECONNECT_CODES: ClassroomErrorCode[] = ["session-expired", "permission-denied"];

/** Reports what actually happened, with both halves named — never a vague "sync complete". */
function summarizeSync(imported: number, updated: number): string {
  if (imported === 0 && updated === 0) return "Nothing was imported or changed.";
  const parts: string[] = [];
  if (imported > 0) parts.push(`Imported ${imported} assignment${imported === 1 ? "" : "s"}`);
  if (updated > 0) parts.push(`updated ${updated} from Classroom`);
  return `${parts.join(" and ")}.`;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function GoogleClassroomCard() {
  const [status, setStatus] = useState<ClassroomConnectionStatus | null>(null);
  const [busy, setBusy] = useState<"connecting" | "checking" | "disconnecting" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [manageCoursesOpen, setManageCoursesOpen] = useState(false);
  const [scheduleChanges, setScheduleChanges] = useState<ScheduleChangeSummary | null>(null);
  const { workItems, classroomCourseIds, classroomLastSyncAt } = useAppData();
  const importedItems = workItems.filter((item) => item.source === "google-classroom");
  // A real, actionable number: how many of the student's *own* imported items are still sitting on
  // a placeholder duration. Global rather than scoped to the last sync, because the need doesn't
  // go away just because the student closed the review screen without setting one (Part 7).
  const needsEstimateCount = importedItems.filter((item) => item.needsEstimate).length;

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API}/status`, { cache: "no-store" });
      setStatus((await response.json()) as ClassroomConnectionStatus);
    } catch {
      // The status route itself is unreachable — an app-level problem, not a Google one.
      setError("StudyFlow couldn't check the Google Classroom connection. Reload the page and try again.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of server state on mount, not a derived-state loop
    void loadStatus();
  }, [loadStatus]);

  /**
   * The OAuth callback redirects back here with its result in the query string.
   *
   * Read from `window.location` in an effect rather than via `useSearchParams`, which would force
   * this client component's whole route out of static rendering for a value that only matters for
   * the one render right after a redirect. The parameters are stripped afterwards so a refresh
   * doesn't replay a stale "connected" banner.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("classroom");
    if (!result) return;

    if (result === "connected") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the redirect result from the URL, an external source
      setNotice("Google Classroom connected.");
      setNeedsReconnect(false);
      // Straight into "pick your classes and sync" (Phase 6A, Part 4) — a student who just
      // finished the Google consent screen shouldn't have to notice and click "Sync now"
      // themselves to get to the next real step. Nothing is imported until they confirm inside it.
      setSyncOpen(true);
    } else {
      const reason = params.get("reason");
      setError(classroomErrorMessage((reason as ClassroomErrorCode) ?? "unknown"));
    }

    params.delete("classroom");
    params.delete("reason");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  function connect() {
    // Guarded so an impatient double-click can't start two consent flows.
    if (busy) return;
    setBusy("connecting");
    setError(null);
    setNotice(null);
    // A full navigation, not a router push: this route answers with a 302 to Google's own consent
    // screen, which client-side routing cannot follow.
    window.location.assign(new URL(`${API}/connect`, window.location.origin));
  }

  async function checkConnection() {
    if (busy) return;
    setBusy("checking");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${API}/courses`, { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiError;
        if (body.error && RECONNECT_CODES.includes(body.error)) {
          // The authorization itself is gone — a generic red error banner would understate it, and
          // repeating "Check connection" against a revoked grant would just fail the same way again
          // (Part 9). The reconnect state replaces the usual actions with the one that actually helps.
          setNeedsReconnect(true);
        } else {
          setError(body.message ?? classroomErrorMessage("unknown"));
        }
      } else {
        const body = (await response.json()) as { courseCount: number };
        setNeedsReconnect(false);
        setNotice(
          body.courseCount === 0
            ? classroomErrorMessage("no-courses")
            : `Connection is working — ${body.courseCount} ${body.courseCount === 1 ? "class" : "classes"} found.`
        );
      }
      await loadStatus();
    } catch {
      setError(classroomErrorMessage("network-error"));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setConfirmDisconnect(false);
    setBusy("disconnecting");
    setError(null);
    setNotice(null);
    try {
      await fetch(`${API}/disconnect`, { method: "POST" });
      setNeedsReconnect(false);
      setNotice("Google Classroom disconnected. Nothing in StudyFlow or in Classroom was deleted.");
      await loadStatus();
    } catch {
      setError(classroomErrorMessage("network-error"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">Google Classroom</h2>
        {status?.connected && !needsReconnect && <Badge tone="success">Connected</Badge>}
        {needsReconnect && <Badge tone="warning">Reconnect needed</Badge>}
        {status && !status.configured && <Badge tone="neutral">Not set up</Badge>}
      </div>

      {status === null ? (
        <p className="text-xs text-ink-faint">Checking connection…</p>
      ) : !status.configured ? (
        <UnconfiguredState missing={status.missingConfig} />
      ) : needsReconnect ? (
        <ReconnectState />
      ) : status.connected ? (
        <ConnectedState
          status={status}
          courseSelectionLabel={classroomCourseIds.length === 0 ? "All active courses" : `${classroomCourseIds.length} selected`}
          lastSyncAt={classroomLastSyncAt}
          importedCount={importedItems.length}
          needsEstimateCount={needsEstimateCount}
          onManageCourses={() => setManageCoursesOpen(true)}
        />
      ) : (
        <NotConnectedState />
      )}

      {status?.configured && <ClassroomExplainer />}

      {status?.configured && (
        <p className="mt-2 text-xs text-ink-faint">
          <span className="font-medium text-ink-muted">Read-only connection.</span> StudyFlow can read your selected
          Classroom courses and coursework. It cannot change or submit anything in Google Classroom.
        </p>
      )}

      {notice && (
        <p className="mt-3 rounded-md border border-brand-soft bg-brand-soft px-3 py-2 text-xs text-brand-strong">{notice}</p>
      )}

      {/* Real engine output — the same diff the rest of the app uses. Nothing here is composed to
          sound plausible, and it says so explicitly even when nothing changed (Part 13). */}
      {scheduleChanges && <ScheduleChangeNotice summary={scheduleChanges} />}

      {/* Only the follow-ups that actually apply, right after a sync that produced them (Part 9). */}
      {scheduleChanges && (needsEstimateCount > 0 || scheduleChanges.changes.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {needsEstimateCount > 0 && (
            <Link href="/assignments" className="text-brand-strong underline underline-offset-2 hover:opacity-80">
              Review assignments needing estimates
            </Link>
          )}
          {scheduleChanges.changes.length > 0 && (
            <Link href="/schedule" className="text-brand-strong underline underline-offset-2 hover:opacity-80">
              View updated schedule
            </Link>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-danger-soft bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {status?.configured && (
        <div className="mt-4 flex flex-wrap gap-2">
          {needsReconnect ? (
            <Button size="sm" onClick={connect} disabled={busy !== null}>
              {busy === "connecting" ? "Opening Google…" : "Reconnect"}
            </Button>
          ) : status.connected ? (
            <>
              <Button size="sm" onClick={() => setSyncOpen(true)} disabled={busy !== null}>
                Sync now
              </Button>
              <Button size="sm" variant="secondary" onClick={checkConnection} disabled={busy !== null}>
                {busy === "checking" ? "Checking…" : "Check connection"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDisconnect(true)} disabled={busy !== null}>
                {busy === "disconnecting" ? "Disconnecting…" : "Disconnect"}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={connect} disabled={busy !== null}>
              {busy === "connecting" ? "Opening Google…" : "Connect Google Classroom"}
            </Button>
          )}
        </div>
      )}

      {syncOpen && (
        <ClassroomSyncModal
          open
          onClose={() => setSyncOpen(false)}
          onApplied={({ imported, updated, changes }) => {
            setError(null);
            setScheduleChanges(changes);
            setNotice(summarizeSync(imported, updated));
          }}
          onAuthError={(code) => {
            if (RECONNECT_CODES.includes(code)) setNeedsReconnect(true);
          }}
        />
      )}

      {manageCoursesOpen && <ClassroomCourseManager open onClose={() => setManageCoursesOpen(false)} />}

      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect Google Classroom?"
        description="StudyFlow will stop reading your Classroom classes and will remove its access from your Google account. Nothing in Google Classroom changes, and no StudyFlow assignments, sessions, or history are deleted. You can reconnect at any time."
        confirmLabel="Disconnect"
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={disconnect}
      />
    </section>
  );
}

/**
 * Shown when the deployment has no Google credentials.
 *
 * The missing variable names are listed because the only person who can act on this is whoever
 * deployed the app, and "something isn't configured" would waste their time. Names only — the route
 * never sends values, so there is nothing sensitive to render.
 */
function UnconfiguredState({ missing }: { missing: string[] }) {
  return (
    <div className="text-xs text-ink-muted">
      <p className="mb-2">
        Google Classroom isn&apos;t set up for this copy of StudyFlow. Connecting requires Google credentials to be
        configured first — everything else in StudyFlow works normally without it.
      </p>
      {missing.length > 0 && (
        <p className="text-ink-faint">
          Missing configuration: <span className="font-medium text-ink-muted">{missing.join(", ")}</span>. See
          docs/google-classroom-setup.md.
        </p>
      )}
    </div>
  );
}

function NotConnectedState() {
  return (
    <div className="text-xs text-ink-muted">
      <p className="mb-2">Connect your Google Classroom account to bring your coursework into StudyFlow.</p>
      <p className="text-ink-faint">
        StudyFlow requests <span className="font-medium text-ink-muted">read-only</span> access to the classes
        you&apos;re enrolled in and their coursework. It can&apos;t post, submit, edit, or delete anything in Classroom,
        and you choose what gets imported.
      </p>
    </div>
  );
}

/**
 * Shown when Google no longer honors StudyFlow's authorization — revoked from the student's Google
 * account, or expired (Phase 5C, Part 9).
 *
 * The one thing this state exists to say plainly: nothing in the student's planner was touched.
 * Sync and Check connection are both hidden here rather than left active — retrying either would
 * just fail the same way again, since the problem is the authorization itself, not the request.
 */
function ReconnectState() {
  return (
    <div className="text-xs text-ink-muted">
      <p className="mb-2 font-medium text-ink">StudyFlow can no longer access your Classroom data.</p>
      <p className="text-ink-faint">
        Your existing StudyFlow assignments and schedule are still safe — nothing has been changed or deleted.
        Reconnecting restores the connection; nothing else needs to happen first.
      </p>
    </div>
  );
}

/**
 * The connected view.
 *
 * Everything here is a fact the server actually recorded. There is no account name, because
 * StudyFlow never asked Google for one — printing an email would mean requesting an identity scope
 * it doesn't need. "Last checked" and the course count are absent until a check has genuinely run,
 * rather than being shown as "never" or "0".
 */
function ConnectedState({
  status,
  courseSelectionLabel,
  lastSyncAt,
  importedCount,
  needsEstimateCount,
  onManageCourses,
}: {
  status: ClassroomConnectionStatus;
  courseSelectionLabel: string;
  lastSyncAt?: string;
  importedCount: number;
  needsEstimateCount: number;
  onManageCourses: () => void;
}) {
  return (
    <div className="text-xs text-ink-muted">
      <p className="mb-2">
        StudyFlow reads your classes and coursework. It never changes anything in Google Classroom, and it only imports
        what you choose during a sync.
      </p>
      <dl className="flex flex-col gap-1 text-ink-faint">
        <div className="flex flex-wrap items-center gap-2">
          <dt>Syncing</dt>
          <dd className="text-ink-muted">{courseSelectionLabel}</dd>
          <button onClick={onManageCourses} className="text-brand-strong underline underline-offset-2 hover:opacity-80">
            Manage courses
          </button>
        </div>
        {status.courseCount !== undefined && <Row label="Classes found" value={String(status.courseCount)} />}
        {/* Always shown, including "Never synced" — a student should never have to guess whether
            Classroom data might be stale (Part 10). No background sync exists to make this stale
            in the first place; Sync Now is always the manual action that changes it. */}
        <Row label="Sync" value={formatSyncRecency(lastSyncAt)} />
        {status.lastCheckedAt && <Row label="Last checked" value={formatTimestamp(status.lastCheckedAt)} />}
        {status.connectedAt && <Row label="Connected" value={formatTimestamp(status.connectedAt)} />}
        {/* A count of what's actually in the planner, not of what Classroom holds — Settings
            reports StudyFlow's state, and doesn't try to be a second Classroom dashboard. */}
        {importedCount > 0 && <Row label="Imported into StudyFlow" value={String(importedCount)} />}
      </dl>
      {needsEstimateCount > 0 && (
        <p className="mt-2 text-warning">
          {needsEstimateCount} imported {needsEstimateCount === 1 ? "item" : "items"} still {needsEstimateCount === 1 ? "needs" : "need"} an
          estimate — see Assignments.
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <dt>{label}</dt>
      <dd className="text-ink-muted">{value}</dd>
    </div>
  );
}

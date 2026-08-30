"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ClassroomSyncModal } from "@/components/settings/ClassroomSyncModal";
import { useAppData } from "@/lib/data/store";
import { classroomErrorMessage, type ClassroomConnectionStatus, type ClassroomErrorCode } from "@/lib/integrations/google-classroom";
import type { ScheduleChangeSummary, WorkItemScheduleChange } from "@/scheduling-engine";

/**
 * The Google Classroom connection, in Settings.
 *
 * This component contains no Google URLs, no scope strings and no tokens — it calls StudyFlow's own
 * API routes and renders what they return. That's the boundary the phase is really about: the
 * browser never talks to Google's API directly, so nothing sensitive can end up in client
 * JavaScript.
 *
 * The states it can show are: still loading, not configured (this deployment has no Google
 * credentials), not connected, connecting, connected, and failed. "Not configured" is a real state
 * with real copy rather than a disabled button, because a student looking at a build without
 * credentials deserves to know why the button won't work.
 */

const API = "/api/integrations/google-classroom";

/** The error shape the routes return. Deliberately narrow — a code and vetted copy, nothing else. */
interface ApiError {
  error?: ClassroomErrorCode;
  message?: string;
}

const SCHEDULE_CHANGE_LABEL: Record<WorkItemScheduleChange["kind"], string> = {
  added: "Added",
  removed: "Removed",
  moved: "Moved",
  "duration-changed": "Time changed",
};

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
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [scheduleChanges, setScheduleChanges] = useState<ScheduleChangeSummary | null>(null);
  const { workItems, classroomCourseIds, classroomLastSyncAt } = useAppData();
  const importedCount = workItems.filter((item) => item.source === "google-classroom").length;

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
        setError(body.message ?? classroomErrorMessage("unknown"));
      } else {
        const body = (await response.json()) as { courseCount: number };
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
        {status?.connected && <Badge tone="success">Connected</Badge>}
        {status && !status.configured && <Badge tone="neutral">Not set up</Badge>}
      </div>

      {status === null ? (
        <p className="text-xs text-ink-faint">Checking connection…</p>
      ) : !status.configured ? (
        <UnconfiguredState missing={status.missingConfig} />
      ) : status.connected ? (
        <ConnectedState
          status={status}
          courseSelectionLabel={classroomCourseIds.length === 0 ? "All active courses" : `${classroomCourseIds.length} selected`}
          lastSyncAt={classroomLastSyncAt}
          importedCount={importedCount}
        />
      ) : (
        <NotConnectedState />
      )}

      {notice && (
        <p className="mt-3 rounded-md border border-brand-soft bg-brand-soft px-3 py-2 text-xs text-brand-strong">{notice}</p>
      )}

      {scheduleChanges && scheduleChanges.changes.length > 0 && (
        // Real engine output — the same diff the rest of the app uses. Nothing here is composed to
        // sound plausible.
        <div className="mt-3 rounded-md border border-border bg-paper px-3 py-2">
          <p className="mb-1 text-xs font-medium text-ink">Your schedule was updated</p>
          <ul className="flex flex-col gap-0.5 text-xs text-ink-muted">
            {scheduleChanges.changes.slice(0, 6).map((change) => (
              <li key={change.workItemId} className="break-words">
                {SCHEDULE_CHANGE_LABEL[change.kind]} · {change.title}
                {change.after && <span className="text-ink-faint"> → {change.after}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-md border border-danger-soft bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      {status?.configured && (
        <div className="mt-4 flex flex-wrap gap-2">
          {status.connected ? (
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
        />
      )}

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
}: {
  status: ClassroomConnectionStatus;
  courseSelectionLabel: string;
  lastSyncAt?: string;
  importedCount: number;
}) {
  return (
    <div className="text-xs text-ink-muted">
      <p className="mb-2">
        StudyFlow reads your classes and coursework. It never changes anything in Google Classroom, and it only imports
        what you choose during a sync.
      </p>
      <dl className="flex flex-col gap-1 text-ink-faint">
        <Row label="Syncing" value={courseSelectionLabel} />
        {status.courseCount !== undefined && <Row label="Classes found" value={String(status.courseCount)} />}
        {lastSyncAt && <Row label="Last sync" value={formatTimestamp(lastSyncAt)} />}
        {status.lastCheckedAt && <Row label="Last checked" value={formatTimestamp(status.lastCheckedAt)} />}
        {status.connectedAt && <Row label="Connected" value={formatTimestamp(status.connectedAt)} />}
        {/* A count of what's actually in the planner, not of what Classroom holds — Settings
            reports StudyFlow's state, and doesn't try to be a second Classroom dashboard. */}
        {importedCount > 0 && <Row label="Imported into StudyFlow" value={String(importedCount)} />}
      </dl>
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

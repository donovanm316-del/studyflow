"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { classroomErrorMessage, type ClassroomConnectionStatus, type ClassroomErrorCode } from "@/lib/integrations/google-classroom";

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
        <ConnectedState status={status} />
      ) : (
        <NotConnectedState />
      )}

      {notice && (
        <p className="mt-3 rounded-md border border-brand-soft bg-brand-soft px-3 py-2 text-xs text-brand-strong">{notice}</p>
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
        StudyFlow requests <span className="font-medium text-ink-muted">read-only</span> access to the list of classes
        you&apos;re enrolled in. It can&apos;t post, submit, edit, or delete anything in Classroom.
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
function ConnectedState({ status }: { status: ClassroomConnectionStatus }) {
  return (
    <div className="text-xs text-ink-muted">
      <p className="mb-2">
        StudyFlow can read the list of classes you&apos;re enrolled in. Importing assignments isn&apos;t built yet — this
        connection doesn&apos;t add anything to your schedule on its own.
      </p>
      <dl className="flex flex-col gap-1 text-ink-faint">
        {status.connectedAt && (
          <div className="flex gap-2">
            <dt>Connected</dt>
            <dd className="text-ink-muted">{formatTimestamp(status.connectedAt)}</dd>
          </div>
        )}
        {status.lastCheckedAt && (
          <div className="flex gap-2">
            <dt>Last checked</dt>
            <dd className="text-ink-muted">{formatTimestamp(status.lastCheckedAt)}</dd>
          </div>
        )}
        {status.courseCount !== undefined && (
          <div className="flex gap-2">
            <dt>Classes found</dt>
            <dd className="text-ink-muted">{status.courseCount}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

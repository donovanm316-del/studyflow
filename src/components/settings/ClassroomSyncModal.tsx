"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useAppData } from "@/lib/data/store";
import { useScheduleInput } from "@/lib/data/useSchedule";
import { normalizeExternalItem, type ExternalWorkItem } from "@/lib/data/import";
import {
  describeCourseFailures,
  externalKey,
  previewSyncImpact,
  reconcileCoursework,
  summarizeReconcile,
  updatesForAcceptedChanges,
  type ReconciledItem,
  type ReconcileResult,
} from "@/lib/data/classroom-sync";
import { classroomErrorMessage, type ClassroomErrorCode, type ExternalCourse } from "@/lib/integrations/google-classroom";
import { todayDateOnly } from "@/lib/now";
import { formatDueLabel } from "@/lib/schedule-format";
import { addDays, type ScheduleChangeSummary } from "@/scheduling-engine";
import type { NewWorkItemInput } from "@/lib/data/store";

/** Codes that mean the *authorization* itself is gone, not a transient failure (Part 9). */
const RECONNECT_CODES: ClassroomErrorCode[] = ["session-expired", "permission-denied"];

/**
 * The Google Classroom sync review.
 *
 * The product rule this component exists to enforce: **the student sees what will happen before it
 * happens.** Coursework is retrieved, sorted into what's new, what a teacher changed, what has no
 * deadline, and what StudyFlow already has — and then nothing is written until they press the
 * button. Every group is opt-in per item.
 *
 * It contains no Google API code. It calls StudyFlow's own route, hands the result to the pure
 * reconciliation functions, and renders the outcome.
 */

const API = "/api/integrations/google-classroom";

interface CourseWorkResponse {
  courses: { externalCourseId: string; courseName: string; items: ExternalWorkItem[]; failed?: { code: string; message: string } }[];
  allCourses: ExternalCourse[];
  failedCourses: { courseName: string; message: string }[];
  lastCheckedAt?: string;
}

/** Per-item decisions made on the review screen, keyed by external identity. */
interface Choice {
  estimatedMinutes?: number;
  targetDate?: string;
}

export interface ClassroomSyncModalProps {
  open: boolean;
  onClose: () => void;
  /** Told what actually happened, so Settings can show an honest summary after the modal closes. */
  onApplied: (summary: {
    imported: number;
    updated: number;
    changes: ScheduleChangeSummary;
    /** The newly imported items themselves — title/deadline/estimate, for naming what changed and
     *  why (Phase 6B, Part 9), not just how many. Never anything Classroom didn't actually say. */
    importedItems: { title: string; dueDate: string; estimatedMinutes: number }[];
  }) => void;
  /**
   * Told when a fetch failed because Google no longer honors the connection — as opposed to a
   * transient network or server problem — so Settings can switch to its persistent "Reconnect"
   * state even after this modal is closed (Part 9).
   */
  onAuthError?: (code: ClassroomErrorCode) => void;
}

export function ClassroomSyncModal({ open, onClose, onApplied, onAuthError }: ClassroomSyncModalProps) {
  const { workItems, classroomCourseIds, applyClassroomSync, setClassroomCourseIds } = useAppData();
  const today = todayDateOnly();
  // Wide enough for the diff below to see a newly-imported item land somewhere, without asking the
  // engine to plan a whole term to answer "what changes this week".
  const scheduleInput = useScheduleInput(today, addDays(today, 14));

  const [phase, setPhase] = useState<"loading" | "review" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<ClassroomErrorCode | null>(null);
  const [response, setResponse] = useState<CourseWorkResponse | null>(null);
  const [editingCourses, setEditingCourses] = useState(false);
  const [draftCourseIds, setDraftCourseIds] = useState<string[]>(classroomCourseIds);

  const [selectedNew, setSelectedNew] = useState<Set<string>>(new Set());
  const [selectedChanges, setSelectedChanges] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, Choice>>({});

  const load = useCallback(
    async (courseIds: string[]) => {
      setPhase("loading");
      setError(null);
      setErrorCode(null);
      try {
        const params = new URLSearchParams();
        for (const id of courseIds) params.append("courseId", id);
        const res = await fetch(`${API}/coursework?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: ClassroomErrorCode; message?: string };
          setError(body.message ?? classroomErrorMessage("unknown"));
          setErrorCode(body.error ?? null);
          if (body.error && RECONNECT_CODES.includes(body.error)) onAuthError?.(body.error);
          setPhase("error");
          return;
        }
        setResponse((await res.json()) as CourseWorkResponse);
        setPhase("review");
      } catch {
        setError(classroomErrorMessage("network-error"));
        setPhase("error");
      }
    },
    [onAuthError]
  );

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time fetch when the dialog opens
    void load(classroomCourseIds);
  }, [open, classroomCourseIds, load]);

  /**
   * Reconciliation runs against the student's live work items — so an assignment imported a minute
   * ago is already "already imported" here, and re-opening this dialog can never offer it twice.
   */
  const result: ReconcileResult | null = useMemo(() => {
    if (!response) return null;
    return reconcileCoursework({
      external: response.courses.flatMap((c) => c.items),
      existing: workItems,
      succeededCourseIds: response.courses.filter((c) => !c.failed).map((c) => c.externalCourseId),
    });
  }, [response, workItems]);

  // Default selection: everything new that already has a deadline. Undated work and teacher changes
  // start unselected — both deserve a deliberate decision rather than a default.
  useEffect(() => {
    if (!result) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deriving initial selection from freshly-fetched data
    setSelectedNew(new Set(result.newItems.map((i) => externalKey(i.external)!).filter(Boolean)));
    setSelectedChanges(new Set());
  }, [result]);

  const { imports, updates } = useMemo(() => {
    if (!result) return { imports: [] as NewWorkItemInput[], updates: [] as { id: string; patch: Partial<NewWorkItemInput> }[] };

    const chosen = [...result.newItems, ...result.undatedItems].filter((item) => selectedNew.has(externalKey(item.external)!));
    const built = chosen
      .map((item) => normalizeExternalItem(item.external, today, choices[externalKey(item.external)!] ?? {}))
      // `null` means the item still has no date at all — it simply isn't imported, rather than
      // being given one.
      .filter((input): input is NewWorkItemInput => input !== null);

    return { imports: built, updates: updatesForAcceptedChanges(result, [...selectedChanges], workItems) };
  }, [result, selectedNew, selectedChanges, choices, today, workItems]);

  function apply() {
    const changes = previewSyncImpact(scheduleInput, imports, updates);
    applyClassroomSync({ imports, updates, syncedAt: new Date().toISOString() });
    onApplied({
      imported: imports.length,
      updated: updates.length,
      changes,
      importedItems: imports.map((i) => ({ title: i.title, dueDate: i.dueDate, estimatedMinutes: i.estimatedMinutes })),
    });
    onClose();
  }

  function toggle(set: Set<string>, key: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  }

  function setChoice(key: string, patch: Choice) {
    setChoices((c) => ({ ...c, [key]: { ...c[key], ...patch } }));
  }

  return (
    <Modal open={open} onClose={onClose} title="Google Classroom" className="max-w-2xl">
      {phase === "loading" && <p className="text-sm text-ink-muted">Syncing Classroom…</p>}

      {phase === "error" && errorCode && RECONNECT_CODES.includes(errorCode) ? (
        // The authorization is gone, not just this request — "Try again" would only fail the same
        // way, so it's replaced with the one action that actually helps (Part 9).
        <div>
          <p className="mb-1 text-sm font-medium text-ink">StudyFlow can no longer access your Classroom data.</p>
          <p className="mb-3 text-xs text-ink-faint">
            Your existing StudyFlow assignments and schedule are still safe — nothing has been changed or deleted.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button onClick={() => window.location.assign(new URL(`${API}/connect`, window.location.origin))}>
              Reconnect
            </Button>
          </div>
        </div>
      ) : (
        phase === "error" && (
          <div>
            <p role="alert" className="rounded-md border border-danger-soft bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Close</Button>
              <Button onClick={() => void load(classroomCourseIds)}>Try again</Button>
            </div>
          </div>
        )
      )}

      {phase === "review" && result && response && (
        <div className="flex flex-col gap-5">
          <SyncSummary result={result} />

          {response.failedCourses.length > 0 &&
            (() => {
              const failedNames = response.failedCourses.map((c) => c.courseName);
              const succeededCount = response.courses.filter((c) => !c.failed).length;
              const message = describeCourseFailures(failedNames, succeededCount);
              return (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-soft bg-warning-soft px-3 py-2 text-xs text-warning">
                  <span>{message}</span>
                  <Button size="sm" variant="ghost" onClick={() => void load(classroomCourseIds)}>
                    Retry
                  </Button>
                </div>
              );
            })()}

          <CourseSelection
            allCourses={response.allCourses}
            selectedIds={classroomCourseIds}
            editing={editingCourses}
            draft={draftCourseIds}
            onStartEditing={() => {
              setDraftCourseIds(classroomCourseIds);
              setEditingCourses(true);
            }}
            onToggle={(id) =>
              // See ClassroomCourseManager's `toggle` for why an empty ("all") selection must
              // expand to the full list before removing one, rather than treating absence from an
              // empty list as already-unselected.
              setDraftCourseIds((current) => {
                const base = current.length === 0 ? response!.allCourses.map((c) => c.externalCourseId) : current;
                const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
                return next.length === response!.allCourses.length ? [] : next;
              })
            }
            onCancel={() => setEditingCourses(false)}
            onSave={() => {
              setClassroomCourseIds(draftCourseIds);
              setEditingCourses(false);
              void load(draftCourseIds);
            }}
          />

          <Group
            title="New"
            description="Not in StudyFlow yet. StudyFlow doesn't know how long these take — set an estimate now or later."
            items={result.newItems}
            selected={selectedNew}
            onToggle={(key) => toggle(selectedNew, key, setSelectedNew)}
            onSelectAll={() => setSelectedNew(new Set(result.newItems.map((i) => externalKey(i.external)!)))}
            today={today}
            choices={choices}
            onChoice={setChoice}
          />

          <Group
            title="No deadline in Classroom"
            description="StudyFlow won't invent a due date. Give one of these a target date to import it."
            items={result.undatedItems}
            selected={selectedNew}
            onToggle={(key) => toggle(selectedNew, key, setSelectedNew)}
            today={today}
            choices={choices}
            onChoice={setChoice}
            requiresDate
          />

          <ChangedGroup
            items={result.changedItems}
            selected={selectedChanges}
            onToggle={(id) => toggle(selectedChanges, id, setSelectedChanges)}
            onSelectAll={() => setSelectedChanges(new Set(result.changedItems.map((i) => i.existingId!).filter(Boolean)))}
          />

          {result.disappearedItems.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-ink">No longer in Google Classroom</h3>
              <p className="mb-2 text-xs text-ink-faint">
                Still in StudyFlow, and nothing has been deleted — you may have already finished them. Remove them
                yourself from Assignments if you want them gone.
              </p>
              <ul className="flex flex-col gap-1 text-xs text-ink-muted">
                {result.disappearedItems.map((item) => (
                  <li key={item.workItemId} className="truncate">
                    {item.title}
                    {item.courseName && <span className="text-ink-faint"> · {item.courseName}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.newItems.length === 0 && result.undatedItems.length === 0 && result.changedItems.length === 0 && (
            <p className="text-sm text-ink-muted">Nothing new — StudyFlow is up to date with Google Classroom.</p>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={apply} disabled={imports.length === 0 && updates.length === 0}>
              {applyLabel(imports.length, updates.length)}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * The concise "Classroom synced" result (Phase 5C, Part 2/4) — a plain readout of
 * `summarizeReconcile`'s counts, in the same order the groups below appear in.
 *
 * Deliberately not interactive: this is the answer to "what happened?", not another decision the
 * student has to make. "Unchanged" in particular is a count and nothing more — the phase spec is
 * explicit that the student should never have to review every unchanged item one by one.
 */
function SyncSummary({ result }: { result: ReconcileResult }) {
  const counts = summarizeReconcile(result);
  const needsAttention = counts.undatedCount;

  return (
    <div className="rounded-md border border-border bg-paper px-3 py-2">
      <p className="text-sm font-medium text-ink">Classroom synced</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-muted">
        <li>{counts.newCount} new</li>
        <li>{counts.changedCount} changed</li>
        <li>{counts.unchangedCount} unchanged</li>
        {counts.disappearedCount > 0 && <li>{counts.disappearedCount} no longer in Classroom</li>}
      </ul>
      {needsAttention > 0 && (
        <p className="mt-1 text-xs text-warning">
          {needsAttention} assignment{needsAttention === 1 ? "" : "s"} need{needsAttention === 1 ? "s" : ""} a target date.
        </p>
      )}
    </div>
  );
}

function applyLabel(imported: number, updated: number): string {
  const parts: string[] = [];
  if (imported > 0) parts.push(`Import ${imported}`);
  if (updated > 0) parts.push(`update ${updated}`);
  if (parts.length === 0) return "Nothing selected";
  return parts.join(" and ").replace(/^./, (c) => c.toUpperCase());
}

function CourseSelection({
  allCourses,
  selectedIds,
  editing,
  draft,
  onStartEditing,
  onToggle,
  onCancel,
  onSave,
}: {
  allCourses: ExternalCourse[];
  selectedIds: string[];
  editing: boolean;
  draft: string[];
  onStartEditing: () => void;
  onToggle: (id: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  // An empty stored selection means "all active courses" — the state a student is in before they've
  // excluded anything, not an instruction to sync nothing.
  const summary = selectedIds.length === 0 ? "All active courses" : `${selectedIds.length} of ${allCourses.length} courses`;

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span>
          Syncing: <span className="font-medium text-ink">{summary}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={onStartEditing}>Choose courses</Button>
      </div>
    );
  }

  return (
    <section className="rounded-md border border-border bg-paper p-3">
      <h3 className="mb-2 text-sm font-semibold text-ink">Courses to sync</h3>
      <ul className="flex flex-col gap-2">
        {allCourses.map((course) => (
          <li key={course.externalCourseId} className="flex items-start gap-2">
            <input
              id={`course-${course.externalCourseId}`}
              type="checkbox"
              checked={draft.length === 0 || draft.includes(course.externalCourseId)}
              onChange={() => onToggle(course.externalCourseId)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong accent-brand"
            />
            <label htmlFor={`course-${course.externalCourseId}`} className="min-w-0 text-sm text-ink">
              {course.name}
              {course.section && <span className="text-ink-faint"> · {course.section}</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={onSave}>Save and re-check</Button>
      </div>
    </section>
  );
}

function Group({
  title,
  description,
  items,
  selected,
  onToggle,
  onSelectAll,
  today,
  choices,
  onChoice,
  requiresDate,
}: {
  title: string;
  description: string;
  items: ReconciledItem[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onSelectAll?: () => void;
  today: string;
  choices: Record<string, Choice>;
  onChoice: (key: string, patch: Choice) => void;
  requiresDate?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {title} <span className="font-normal text-ink-faint">({items.length})</span>
        </h3>
        {onSelectAll && (
          <Button size="sm" variant="ghost" onClick={onSelectAll}>Select all</Button>
        )}
      </div>
      <p className="mb-3 text-xs text-ink-faint">{description}</p>

      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {items.map((item) => {
          const key = externalKey(item.external)!;
          const choice = choices[key] ?? {};
          const isSelected = selected.has(key);
          const missingDate = requiresDate && !choice.targetDate;

          return (
            <li key={key} className="flex flex-col gap-2 py-3">
              <div className="flex items-start gap-2">
                <input
                  id={`item-${key}`}
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(key)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong accent-brand"
                />
                <div className="min-w-0 flex-1">
                  <label htmlFor={`item-${key}`} className="block break-words text-sm font-medium text-ink">
                    {item.external.title}
                  </label>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
                    {item.external.courseName && <span className="break-words">{item.external.courseName}</span>}
                    {item.external.dueDate ? (
                      <span>{formatDueLabel(item.external.dueDate, today)}</span>
                    ) : (
                      <span className="text-ink-faint">No due date in Classroom</span>
                    )}
                  </p>
                  {item.possibleManualDuplicates.length > 0 && (
                    // A warning, never an automatic merge — StudyFlow has no way to know whether
                    // these are the same assignment, and the student does.
                    <p className="mt-1 text-xs text-warning">
                      You may already have this in StudyFlow as &ldquo;{item.possibleManualDuplicates[0].title}&rdquo;.
                    </p>
                  )}
                </div>
              </div>

              {isSelected && (
                <div className="flex flex-wrap gap-3 pl-6">
                  {requiresDate && (
                    <label className="flex flex-col gap-1 text-xs text-ink-muted">
                      Your target date
                      <input
                        type="date"
                        value={choice.targetDate ?? ""}
                        onChange={(e) => onChoice(key, { targetDate: e.target.value })}
                        className="h-9 rounded-md border border-border-strong bg-surface px-2 text-sm text-ink"
                      />
                      {/* Explicit because it matters for how the engine treats the deadline: this is
                          a self-set target, not a hard deadline the teacher set (Part 8). */}
                      <span className="text-ink-faint">Yours to set — not a deadline from your teacher.</span>
                    </label>
                  )}
                  <label className="flex flex-col gap-1 text-xs text-ink-muted">
                    Estimate (min)
                    <input
                      type="number"
                      min={5}
                      step={5}
                      placeholder="Not set"
                      value={choice.estimatedMinutes ?? ""}
                      onChange={(e) =>
                        onChoice(key, { estimatedMinutes: e.target.value ? Number(e.target.value) : undefined })
                      }
                      className="h-9 w-28 rounded-md border border-border-strong bg-surface px-2 text-sm text-ink"
                    />
                  </label>
                  {missingDate && (
                    <p className="self-end text-xs text-warning">Needs a date before it can be imported.</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Teacher-side changes.
 *
 * Shown as before → after rather than as a count, because "1 item changed" tells a student nothing
 * they can act on, and a moved deadline is exactly the thing they need to see. Unselected by
 * default: accepting a change rewrites a date StudyFlow has already planned around.
 */
function ChangedGroup({
  items,
  selected,
  onToggle,
  onSelectAll,
}: {
  items: ReconciledItem[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
}) {
  if (items.length === 0) return null;

  return (
    <section>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          Changed in Classroom <span className="font-normal text-ink-faint">({items.length})</span>
        </h3>
        <Button size="sm" variant="ghost" onClick={onSelectAll}>Select all</Button>
      </div>
      <p className="mb-3 text-xs text-ink-faint">
        Your estimates, sessions, and progress are kept either way — only what Classroom controls is updated.
      </p>

      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {items.map((item) => (
          <li key={item.existingId} className="flex items-start gap-2 py-3">
            <input
              id={`change-${item.existingId}`}
              type="checkbox"
              checked={selected.has(item.existingId!)}
              onChange={() => onToggle(item.existingId!)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong accent-brand"
            />
            <div className="min-w-0 flex-1">
              <label htmlFor={`change-${item.existingId}`} className="block break-words text-sm font-medium text-ink">
                {item.external.title}
              </label>
              <ul className="mt-1 flex flex-col gap-1">
                {item.changes.map((change) => (
                  <li key={change.field} className="flex flex-wrap items-center gap-x-2 text-xs">
                    <Badge tone={change.field === "deadline" ? "warning" : "neutral"}>{change.label}</Badge>
                    <span className="break-words text-ink-muted">
                      {change.before} → <span className="font-medium text-ink">{change.after}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {/* Names the two outcomes explicitly, tied to the checkbox above rather than adding a
                  second control — checked applies the change on Import, unchecked keeps the current
                  plan exactly as it is (Part 5). */}
              <p className="mt-1 text-xs text-ink-faint">
                {selected.has(item.existingId!) ? "Will accept this change." : "Will keep your current plan."}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

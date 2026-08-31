"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useAppData } from "@/lib/data/store";
import { classroomErrorMessage, type ExternalCourse } from "@/lib/integrations/google-classroom";

/**
 * Standalone course selection, reachable from Settings without starting a sync (Phase 5C, Part 12).
 *
 * Phase 5B's course picker only existed inside the sync review, so changing which classes to follow
 * meant fetching every selected class's coursework first — wasteful when all the student wants is
 * to turn one class off. This calls the lighter `/courses` endpoint (course list only, no
 * coursework) instead.
 *
 * The one rule this component has to get right: **deselecting a course never touches anything
 * already imported from it.** `classroomCourseIds` only governs which courses a future sync
 * fetches — nothing here calls `removeWorkItem`, and nothing in the store's `applyClassroomSync` or
 * `setClassroomCourseIds` reads or writes `workItems` for a course that drops out of the selection.
 * A work item that already exists keeps existing.
 */

const API = "/api/integrations/google-classroom/courses";

export function ClassroomCourseManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { classroomCourseIds, setClassroomCourseIds, workItems } = useAppData();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<ExternalCourse[]>([]);
  const [selected, setSelected] = useState<string[]>(classroomCourseIds);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setPhase("loading");
      try {
        const res = await fetch(API, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          setError(body.message ?? classroomErrorMessage("unknown"));
          setPhase("error");
          return;
        }
        const body = (await res.json()) as { courses: ExternalCourse[] };
        setCourses(body.courses);
        setPhase("ready");
      } catch {
        if (!cancelled) {
          setError(classroomErrorMessage("network-error"));
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /**
   * Toggles one course, correctly starting from the *implicit* "all" state.
   *
   * `selected: []` means "every active course", so unchecking one course while `selected` is still
   * empty can't be represented as removing it from an empty list — that would just add it back as
   * the only entry (`toggle` called on `[]` with nothing to remove would otherwise leave the box
   * checked, since presence, not absence, is what "selected" means here). It first has to expand to
   * the full course list, then remove the one being turned off. If every course ends up explicitly
   * selected again, it collapses back to `[]` so a class the student hasn't seen yet — added to
   * Classroom later — is still covered by "all" rather than silently excluded.
   */
  function toggle(id: string) {
    setSelected((current) => {
      const base = current.length === 0 ? courses.map((c) => c.externalCourseId) : current;
      const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      return next.length === courses.length ? [] : next;
    });
  }

  function save() {
    setClassroomCourseIds(selected);
    onClose();
  }

  /** How many currently-imported items came from a course this student is about to leave out. */
  function importedCountFor(courseId: string): number {
    return workItems.filter((item) => item.source === "google-classroom" && item.externalCourseId === courseId).length;
  }

  return (
    <Modal open={open} onClose={onClose} title="Classroom courses">
      {phase === "loading" && <p className="text-sm text-ink-muted">Loading your courses…</p>}

      {phase === "error" && (
        <div>
          <p role="alert" className="rounded-md border border-danger-soft bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}

      {phase === "ready" && (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-ink-faint">
            Choose which active classes StudyFlow syncs. Turning a class off only stops new updates from it — anything
            already imported stays in StudyFlow.
          </p>

          {courses.length === 0 ? (
            <p className="text-sm text-ink-muted">No active Classroom courses were found for your account.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border border-y border-border">
              {courses.map((course) => {
                const imported = importedCountFor(course.externalCourseId);
                return (
                  <li key={course.externalCourseId} className="flex items-start gap-2 py-3">
                    <input
                      id={`manage-course-${course.externalCourseId}`}
                      type="checkbox"
                      checked={selected.length === 0 || selected.includes(course.externalCourseId)}
                      onChange={() => toggle(course.externalCourseId)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong accent-brand"
                    />
                    <label htmlFor={`manage-course-${course.externalCourseId}`} className="min-w-0 flex-1 text-sm text-ink">
                      <span className="break-words">{course.name}</span>
                      {course.section && <span className="text-ink-faint"> · {course.section}</span>}
                      {imported > 0 && (
                        <span className="block text-xs text-ink-faint">
                          {imported} already imported into StudyFlow
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

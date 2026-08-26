"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { WorkItemModal } from "@/components/tasks/WorkItemModal";
import { CommitmentModal } from "@/components/tasks/CommitmentModal";
import { WorkloadStatusBadge } from "@/components/schedule/WorkloadStatusBadge";
import { useAppData } from "@/lib/data/store";
import { useSchedule } from "@/lib/data/useSchedule";
import { currentWeekRange, todayDateOnly } from "@/lib/now";
import { formatDueLabel, formatTimeRange } from "@/lib/schedule-format";
import { formatMinutesAsHoursMinutes } from "@/scheduling-engine";
import {
  buildPlanningProfileFromOnboarding,
  DEFAULT_ONBOARDING_ANSWERS,
  isValidAvailabilityWindow,
  type OnboardingAnswers,
} from "@/lib/onboarding";
import type { BreakPreference, CourseRigor, FreeTimePriority, WorkStyle, WorkloadTolerance } from "@/types/models";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TOTAL_STEPS = 10; // steps 0..9; step 10 is the post-finish summary, not part of this count

export default function OnboardingPage() {
  const router = useRouter();
  const { planningProfile, commitments, workItems, addWorkItem, addCommitment, updatePlanningProfile, completeOnboarding } =
    useAppData();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>(DEFAULT_ONBOARDING_ANSWERS);
  const [finished, setFinished] = useState(false);
  const [addingCommitment, setAddingCommitment] = useState(false);
  const [addingWorkItem, setAddingWorkItem] = useState(false);

  const today = todayDateOnly();
  const { start, end } = currentWeekRange();
  const result = useSchedule(start, end); // only meaningful for display once `finished` is true

  function finishOnboarding(useAnswers: OnboardingAnswers) {
    updatePlanningProfile(buildPlanningProfileFromOnboarding(useAnswers, planningProfile.userId));
    completeOnboarding();
  }

  function handleBuildSchedule() {
    finishOnboarding(answers);
    setFinished(true);
  }

  function handleSkipSetup() {
    finishOnboarding(answers);
    router.push("/dashboard");
  }

  if (finished) {
    const todaysBlocks = result.blocks.filter((b) => b.start.slice(0, 10) === today && b.status === "planned");
    const upcoming = workItems
      .filter((item) => item.status !== "completed")
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
      .slice(0, 5);
    const weeklyMinutes = result.dailyForecast.reduce((sum, d) => sum + d.workMinutes, 0);
    const oneExplanation = Object.values(result.decisionExplanations)[0];

    return (
      <OnboardingShell hideProgress>
        <h1 className="text-lg font-semibold text-ink">Your first StudyFlow plan is ready.</h1>
        <p className="mt-1 text-sm text-ink-muted">Here&apos;s what StudyFlow built from what you told it.</p>

        <div className="mt-5">
          <WorkloadStatusBadge status={result.workloadStatus} />
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs font-medium text-ink-muted">Today</p>
            {todaysBlocks.length === 0 ? (
              <p className="mt-1 text-sm text-ink">Nothing scheduled yet today.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {todaysBlocks.slice(0, 4).map((b) => (
                  <li key={b.id} className="text-sm text-ink">{b.title} <span className="text-ink-faint">· {formatTimeRange(b)}</span></li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs font-medium text-ink-muted">This week&apos;s estimated workload</p>
            <p className="mt-1 text-sm text-ink">{formatMinutesAsHoursMinutes(weeklyMinutes)}</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs font-medium text-ink-muted">Upcoming deadlines</p>
            {upcoming.length === 0 ? (
              <p className="mt-1 text-sm text-ink">Nothing added yet.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {upcoming.map((item) => (
                  <li key={item.id} className="text-sm text-ink">{item.title} <span className="text-ink-faint">· {formatDueLabel(item.dueDate, today)}</span></li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs font-medium text-ink-muted">Fixed commitments</p>
            {commitments.length === 0 ? (
              <p className="mt-1 text-sm text-ink">None added yet.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {commitments.slice(0, 4).map((c) => (
                  <li key={c.id} className="text-sm text-ink">{c.title}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {oneExplanation && (
          <p className="mt-5 rounded-md border border-brand-soft bg-brand-soft px-3 py-2 text-sm text-brand-strong">
            {oneExplanation.primaryReason}
          </p>
        )}

        <Button className="mt-6" onClick={() => router.push("/dashboard")}>
          Go to Dashboard
        </Button>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell step={step} onSkipAll={step < 9 ? handleSkipSetup : undefined}>
      {step === 0 && (
        <StepWelcome onNext={() => setStep(1)} />
      )}

      {step === 1 && (
        <ChoiceStep
          title="How rigorous are your classes?"
          description="This helps StudyFlow set a sensible default when you add new assignments — you can always change it per item."
          options={[
            { value: "grade_level", label: "Mostly grade-level" },
            { value: "honors", label: "Mostly honors" },
            { value: "ap", label: "Mix of honors/AP" },
            { value: "ib", label: "Mostly AP/IB/advanced" },
            { value: "college_level", label: "College-level / dual enrollment" },
          ]}
          value={answers.rigor}
          onChange={(v) => setAnswers({ ...answers, rigor: v as CourseRigor })}
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <ChoiceStep
          title="How much work are you comfortable doing on a typical school day?"
          description="This is a planning preference, not a requirement — StudyFlow still only schedules the work you actually have, and advanced classes don't force a fixed number of hours."
          options={[
            { value: "light", label: "Light" },
            { value: "moderate", label: "Moderate" },
            { value: "heavy", label: "Heavy" },
            { value: "adaptive", label: "Adaptive — let StudyFlow adjust based on feedback" },
          ]}
          value={answers.workloadTolerance}
          onChange={(v) => setAnswers({ ...answers, workloadTolerance: v as WorkloadTolerance })}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <ChoiceStep
          title="How do you like your breaks?"
          options={[
            { value: "frequent", label: "Frequent breaks" },
            { value: "balanced", label: "Balanced" },
            { value: "minimal", label: "Minimal breaks" },
          ]}
          value={answers.breakPreference}
          onChange={(v) => setAnswers({ ...answers, breakPreference: v as BreakPreference })}
          onBack={() => setStep(2)}
          onNext={() => setStep(4)}
        />
      )}

      {step === 4 && (
        <ChoiceStep
          title="How important is protected free time?"
          options={[
            { value: "high", label: "Very important" },
            { value: "medium", label: "Balanced" },
            { value: "low", label: "I can handle less free time during busy periods" },
          ]}
          value={answers.freeTimePriority}
          onChange={(v) => setAnswers({ ...answers, freeTimePriority: v as FreeTimePriority })}
          onBack={() => setStep(3)}
          onNext={() => setStep(5)}
        />
      )}

      {step === 5 && (
        <ChoiceStep
          title="What's your work style?"
          options={[
            { value: "early", label: "Start early — finish well before deadlines" },
            { value: "consistent", label: "Stay consistent — spread work evenly" },
            { value: "deadline_driven", label: "Work closer to deadlines" },
            { value: "adaptive", label: "Let StudyFlow adapt" },
          ]}
          value={answers.workStyle}
          onChange={(v) => setAnswers({ ...answers, workStyle: v as WorkStyle })}
          onBack={() => setStep(4)}
          onNext={() => setStep(6)}
        />
      )}

      {step === 6 && (
        <StepAvailability
          value={answers.dailyAvailability}
          onChange={(dailyAvailability) => setAnswers({ ...answers, dailyAvailability })}
          onBack={() => setStep(5)}
          onNext={() => setStep(7)}
        />
      )}

      {step === 7 && (
        <div>
          <h2 className="text-base font-semibold text-ink">Any recurring commitments?</h2>
          <p className="mt-1 text-sm text-ink-muted">Practice, clubs, a job — anything StudyFlow should never schedule work over. Optional.</p>
          <div className="mt-4">
            {commitments.length === 0 ? (
              <EmptyState title="None added yet" description="Add one, or skip this step." />
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {commitments.map((c) => (
                  <li key={c.id} className="px-3 py-2 text-sm text-ink">{c.title}</li>
                ))}
              </ul>
            )}
          </div>
          <Button variant="secondary" className="mt-3" onClick={() => setAddingCommitment(true)}>
            Add commitment
          </Button>
          <StepNav onBack={() => setStep(6)} onNext={() => setStep(8)} nextLabel={commitments.length === 0 ? "Skip for now" : "Next"} />
        </div>
      )}

      {step === 8 && (
        <div>
          <h2 className="text-base font-semibold text-ink">Add your first assignments, tests, or projects</h2>
          <p className="mt-1 text-sm text-ink-muted">Just a few is enough to get started — you can add more anytime. Optional.</p>
          <div className="mt-4">
            {workItems.length === 0 ? (
              <EmptyState title="None added yet" description="Add one, or skip this step." />
            ) : (
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {workItems.map((item) => (
                  <li key={item.id} className="flex items-center justify-between px-3 py-2 text-sm text-ink">
                    <span>{item.title}</span>
                    <Badge tone="neutral">{formatDueLabel(item.dueDate, today)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button variant="secondary" className="mt-3" onClick={() => setAddingWorkItem(true)}>
            Add assignment, test, or project
          </Button>
          <StepNav onBack={() => setStep(7)} onNext={() => setStep(9)} nextLabel={workItems.length === 0 ? "Skip for now" : "Next"} />
        </div>
      )}

      {step === 9 && (
        <div>
          <h2 className="text-base font-semibold text-ink">Ready to build your plan?</h2>
          <p className="mt-1 text-sm text-ink-muted">
            StudyFlow uses everything you&apos;ve entered — your assignments, commitments, available time, and
            preferences — to build a realistic schedule.
          </p>
          <div className="mt-4 flex flex-col gap-1 rounded-md border border-border p-3 text-sm text-ink-muted">
            <span>{workItems.length} work item{workItems.length === 1 ? "" : "s"} added</span>
            <span>{commitments.length} commitment{commitments.length === 1 ? "" : "s"} added</span>
          </div>
          <div className="mt-5 flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep(8)}>Back</Button>
            <Button onClick={handleBuildSchedule}>Build My Schedule</Button>
          </div>
        </div>
      )}

      {addingCommitment && (
        <CommitmentModal open onClose={() => setAddingCommitment(false)} onSubmit={addCommitment} />
      )}
      {addingWorkItem && (
        <WorkItemModal
          open
          onClose={() => setAddingWorkItem(false)}
          onSubmit={addWorkItem}
          kindOptions={[
            { value: "assignment", label: "Assignment" },
            { value: "project", label: "Project" },
            { value: "test", label: "Test" },
            { value: "quiz", label: "Quiz" },
          ]}
          defaultRigor={answers.rigor}
        />
      )}
    </OnboardingShell>
  );
}

function OnboardingShell({
  children,
  step,
  hideProgress,
  onSkipAll,
}: {
  children: React.ReactNode;
  step?: number;
  hideProgress?: boolean;
  onSkipAll?: () => void;
}) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-4 flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold tracking-tight text-ink">
            StudyFlow
          </Link>
          {onSkipAll && (
            <button onClick={onSkipAll} className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline">
              Skip setup, use defaults
            </button>
          )}
        </div>

        {!hideProgress && step != null && (
          <div className="mb-5">
            <ProgressBar value={(step / (TOTAL_STEPS - 1)) * 100} label={`Step ${step + 1} of ${TOTAL_STEPS}`} />
          </div>
        )}

        <div className="rounded-lg border border-border bg-surface p-6">{children}</div>
      </div>
    </div>
  );
}

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ink">Let&apos;s build your StudyFlow plan.</h1>
      <p className="mt-2 text-sm text-ink-muted">
        StudyFlow uses your assignments, commitments, available time, and planning preferences to build a
        realistic schedule — deterministic and rule-based, not AI-generated.
      </p>
      <p className="mt-2 text-sm text-ink-muted">A few quick questions, then you can add your first assignments.</p>
      <Button className="mt-5" onClick={onNext}>Get started</Button>
    </div>
  );
}

function StepNav({ onBack, onNext, nextLabel = "Next" }: { onBack?: () => void; onNext: () => void; nextLabel?: string }) {
  return (
    <div className="mt-5 flex items-center justify-between">
      {onBack ? <Button variant="ghost" onClick={onBack}>Back</Button> : <span />}
      <Button onClick={onNext}>{nextLabel}</Button>
    </div>
  );
}

function ChoiceStep<T extends string>({
  title,
  description,
  options,
  value,
  onChange,
  onBack,
  onNext,
}: {
  title: string;
  description?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  onBack?: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      <div className="mt-4 flex flex-col gap-2" role="radiogroup" aria-label={title}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded-md border px-4 py-2.5 text-left text-sm font-medium transition-colors ${
              value === opt.value
                ? "border-brand bg-brand-soft text-brand-strong"
                : "border-border-strong bg-surface text-ink hover:bg-paper"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <StepNav onBack={onBack} onNext={onNext} />
    </div>
  );
}

function StepAvailability({
  value,
  onChange,
  onBack,
  onNext,
}: {
  value: { dayOfWeek: number; earliest: string; latest: string }[];
  onChange: (value: { dayOfWeek: number; earliest: string; latest: string }[]) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [error, setError] = useState<string | undefined>();

  function dayEntry(dayOfWeek: number) {
    return value.find((d) => d.dayOfWeek === dayOfWeek);
  }

  function setDay(dayOfWeek: number, patch: Partial<{ earliest: string; latest: string }> | null) {
    if (patch === null) {
      onChange(value.filter((d) => d.dayOfWeek !== dayOfWeek));
      return;
    }
    const existing = dayEntry(dayOfWeek);
    const next = existing ? { ...existing, ...patch } : { dayOfWeek, earliest: "15:30", latest: "21:00", ...patch };
    onChange([...value.filter((d) => d.dayOfWeek !== dayOfWeek), next]);
  }

  function handleNext() {
    const invalid = value.find((d) => !isValidAvailabilityWindow(d.earliest, d.latest));
    if (invalid) {
      setError(`${DAY_LABELS[invalid.dayOfWeek]}'s end time must be after its start time.`);
      return;
    }
    setError(undefined);
    onNext();
  }

  return (
    <div>
      <h2 className="text-base font-semibold text-ink">When are you realistically able to work?</h2>
      <p className="mt-1 text-sm text-ink-muted">Turn off any day you want kept completely free.</p>
      <div className="mt-4 flex flex-col gap-2">
        {DAY_LABELS.map((label, dayOfWeek) => {
          const entry = dayEntry(dayOfWeek);
          return (
            <div key={dayOfWeek} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
              <label className="flex w-28 shrink-0 items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={!!entry}
                  onChange={(e) => setDay(dayOfWeek, e.target.checked ? {} : null)}
                  className="h-4 w-4 rounded border-border-strong accent-brand"
                />
                {label}
              </label>
              {entry && (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={entry.earliest}
                    onChange={(e) => setDay(dayOfWeek, { earliest: e.target.value })}
                    className="h-8 rounded-md border border-border-strong bg-surface px-2 text-sm text-ink"
                    aria-label={`${label} earliest`}
                  />
                  <span className="text-ink-faint">–</span>
                  <input
                    type="time"
                    value={entry.latest}
                    onChange={(e) => setDay(dayOfWeek, { latest: e.target.value })}
                    className="h-8 rounded-md border border-border-strong bg-surface px-2 text-sm text-ink"
                    aria-label={`${label} latest`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <StepNav onBack={onBack} onNext={handleNext} />
    </div>
  );
}

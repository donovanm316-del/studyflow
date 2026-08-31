/**
 * Personalized time estimation (Phase 4.5C): "how long does THIS student usually need for THIS
 * kind of work?", answered from their own recorded sessions.
 *
 * This is the implementation of what `refineEstimate` has been a documented stub for since Phase 2.
 * It is deterministic and statistical — a median ratio over a recent window, damped by sample size
 * and clamped — not machine learning. Same inputs always produce the same estimate.
 *
 * The student's own number is never overwritten. `personalizeEstimate` returns both figures, and
 * the engine plans with `planningMinutes` while every surface can still show `studentMinutes`.
 */
import {
  ESTIMATE_CONFIDENCE_WEIGHT,
  ESTIMATE_GOOD_SAMPLES,
  ESTIMATE_MAX_RATIO,
  ESTIMATE_MIN_MEANINGFUL_SHIFT,
  ESTIMATE_MIN_RATIO,
  ESTIMATE_MIN_SAMPLES,
  ESTIMATE_RECENT_WINDOW,
  ESTIMATE_STRONG_SAMPLES,
} from "./constants";
import type { CourseRigor, WorkSession, WorkStage, WorkType } from "@/types/models";
import type { SchedulableWorkItem } from "./types";

export type EstimateConfidence = "insufficient" | "limited" | "good" | "strong";

/**
 * How closely the history behind an estimate matches the work being estimated. More specific is
 * preferred, but only when it has enough samples of its own — otherwise this falls back outward.
 */
export type EstimateMatchLevel = "type-rigor-subject" | "type-rigor" | "type" | "overall";

export interface EstimateAdjustment {
  workItemId: string;
  /** What the student themselves entered. Never modified. */
  studentMinutes: number;
  /** What the engine actually plans with. Equals `studentMinutes` when no adjustment applied. */
  planningMinutes: number;
  /** A realistic spread from the student's own 25th–75th percentile, not invented precision. */
  rangeLowMinutes: number;
  rangeHighMinutes: number;
  /** The multiplier actually applied (1 = untouched). */
  appliedRatio: number;
  confidence: EstimateConfidence;
  sampleSize: number;
  matchLevel: EstimateMatchLevel;
  /** True when the planning estimate genuinely differs from the student's. */
  adjusted: boolean;
  /** One plain sentence, or "" when nothing was adjusted. Never speculative. */
  reason: string;
}

interface Bucket {
  /**
   * `actualMinutes` rides alongside each ratio sample (Phase 5C) so a duration suggestion for an
   * item that has no estimate yet — imported work before the student has typed a number
   * — can be read straight from real recorded durations, without needing an existing estimate to
   * scale a ratio against. Scaling the ratio math against an arbitrary anchor instead would produce
   * a plausible-looking number with no real meaning; the actual recorded durations do not have
   * that problem. See `suggestDurationFromHistory`.
   */
  samples: { ratio: number; actualMinutes: number; at: string }[];
}

export interface EstimateHistory {
  /** Keyed by match key; each holds every qualifying sample for that category. */
  buckets: Map<string, Bucket>;
  /** Total usable samples across all work — the "overall" bucket size. */
  totalSamples: number;
}

function keyFor(level: EstimateMatchLevel, workType?: WorkType, rigor?: CourseRigor, subject?: string): string {
  switch (level) {
    case "type-rigor-subject":
      return `t:${workType}|r:${rigor ?? "none"}|s:${(subject ?? "none").trim().toLowerCase()}`;
    case "type-rigor":
      return `t:${workType}|r:${rigor ?? "none"}`;
    case "type":
      return `t:${workType}`;
    default:
      return "overall";
  }
}

/**
 * Turns recorded sessions into per-category ratio samples.
 *
 * A session's `workItemId` is a stage id for decomposed work, so stages are resolved back to their
 * parent item to recover its work type / rigor / subject. Sessions whose work item has since been
 * deleted still count toward overall accuracy (the estimate-vs-actual pair is real) but can't be
 * categorized, which is why they only land in the `overall` bucket.
 */
export function buildEstimateHistory(
  sessions: WorkSession[],
  workItems: SchedulableWorkItem[],
  stages: WorkStage[] = []
): EstimateHistory {
  const itemById = new Map(workItems.map((i) => [i.id, i]));
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const buckets = new Map<string, Bucket>();

  const push = (key: string, ratio: number, actualMinutes: number, at: string) => {
    if (!buckets.has(key)) buckets.set(key, { samples: [] });
    buckets.get(key)!.samples.push({ ratio, actualMinutes, at });
  };

  let totalSamples = 0;
  for (const session of sessions) {
    const planned = session.plannedMinutes;
    const actual = session.minutesSpent;
    // A postponed session records no actual time; a zero planned duration can't produce a ratio.
    if (planned == null || actual == null || planned <= 0 || actual <= 0) continue;

    const ratio = actual / planned;
    const at = session.start;
    push("overall", ratio, actual, at);
    totalSamples += 1;

    const stage = stageById.get(session.workItemId);
    const item = itemById.get(stage ? stage.workItemId : session.workItemId);
    if (!item) continue;

    push(keyFor("type", item.workType), ratio, actual, at);
    push(keyFor("type-rigor", item.workType, item.rigor), ratio, actual, at);
    push(keyFor("type-rigor-subject", item.workType, item.rigor, item.subject), ratio, actual, at);
  }

  return { buckets, totalSamples };
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 1;
  const index = (sortedValues.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sortedValues[low];
  return sortedValues[low] + (sortedValues[high] - sortedValues[low]) * (index - low);
}

function confidenceFor(sampleSize: number): EstimateConfidence {
  if (sampleSize < ESTIMATE_MIN_SAMPLES) return "insufficient";
  if (sampleSize >= ESTIMATE_STRONG_SAMPLES) return "strong";
  if (sampleSize >= ESTIMATE_GOOD_SAMPLES) return "good";
  return "limited";
}

interface Resolved {
  level: EstimateMatchLevel;
  ratios: number[];
  actualMinutes: number[];
  sampleSize: number;
}

/**
 * Picks the most specific category that has enough history to say something, falling back outward
 * (type+rigor+subject → type+rigor → type → overall) rather than reporting a confident number
 * from one or two samples.
 */
function resolveBucket(history: EstimateHistory, item: SchedulableWorkItem): Resolved | null {
  const levels: EstimateMatchLevel[] = ["type-rigor-subject", "type-rigor", "type", "overall"];

  for (const level of levels) {
    const bucket = history.buckets.get(keyFor(level, item.workType, item.rigor, item.subject));
    if (!bucket) continue;
    // Recency: only the most recent samples count, so improvement isn't outweighed by old habits.
    const recent = [...bucket.samples].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, ESTIMATE_RECENT_WINDOW);
    if (recent.length >= ESTIMATE_MIN_SAMPLES) {
      return {
        level,
        ratios: recent.map((r) => r.ratio),
        actualMinutes: recent.map((r) => r.actualMinutes),
        sampleSize: recent.length,
      };
    }
  }
  return null;
}

function roundToFive(minutes: number): number {
  return Math.max(5, Math.round(minutes / 5) * 5);
}

/**
 * Describes what the history actually shows, using the *observed* median rather than the damped
 * ratio the planner applies. Those differ deliberately — the planner is conservative — and stating
 * the damped figure here would be a false claim about the student's own record, and would
 * contradict the same number reported on the Insights page.
 */
function describe(observedRatio: number, sampleSize: number, level: EstimateMatchLevel): string {
  const percent = Math.round(Math.abs(observedRatio - 1) * 100);
  const direction = observedRatio > 1 ? "longer" : "shorter";
  const scope =
    level === "overall"
      ? "Your work overall"
      : level === "type"
        ? "Similar work"
        : "Similar work in this course";
  return `${scope} usually takes about ${percent}% ${direction} than your estimates, based on ${sampleSize} recorded session${sampleSize === 1 ? "" : "s"}.`;
}

/**
 * The student's estimate, adjusted by their own history. Returns an unadjusted result (with
 * `adjusted: false` and an empty reason) whenever there isn't enough relevant history, or when the
 * adjustment would be too small to matter — the UI can then show nothing at all rather than
 * explaining a one-minute difference.
 */
export function personalizeEstimate(item: SchedulableWorkItem, history: EstimateHistory): EstimateAdjustment {
  const studentMinutes = item.estimatedMinutes;
  const unadjusted: EstimateAdjustment = {
    workItemId: item.id,
    studentMinutes,
    planningMinutes: studentMinutes,
    rangeLowMinutes: studentMinutes,
    rangeHighMinutes: studentMinutes,
    appliedRatio: 1,
    confidence: "insufficient",
    sampleSize: 0,
    matchLevel: "overall",
    adjusted: false,
    reason: "",
  };

  // The student can opt this item out entirely (Phase 4.5D, Part 1). History keeps accumulating —
  // only its influence on *this* item's planning is switched off, so the choice is reversible.
  if (item.usePersonalizedEstimate === false) return unadjusted;

  const resolved = resolveBucket(history, item);
  if (!resolved) return unadjusted;

  const sorted = [...resolved.ratios].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const confidence = confidenceFor(resolved.sampleSize);
  if (confidence === "insufficient") return { ...unadjusted, sampleSize: resolved.sampleSize, matchLevel: resolved.level };

  // Damp by confidence, then clamp. Both are needed: damping keeps a thin history from moving the
  // schedule as much as a thick one, clamping caps how far even a thick history may move it.
  const weight = ESTIMATE_CONFIDENCE_WEIGHT[confidence];
  const damped = 1 + (median - 1) * weight;
  const applied = Math.min(ESTIMATE_MAX_RATIO, Math.max(ESTIMATE_MIN_RATIO, damped));

  if (Math.abs(applied - 1) < ESTIMATE_MIN_MEANINGFUL_SHIFT) {
    return {
      ...unadjusted,
      appliedRatio: 1,
      confidence,
      sampleSize: resolved.sampleSize,
      matchLevel: resolved.level,
    };
  }

  const planningMinutes = roundToFive(studentMinutes * applied);
  const clampSpread = (r: number) => Math.min(ESTIMATE_MAX_RATIO, Math.max(ESTIMATE_MIN_RATIO, 1 + (r - 1) * weight));

  return {
    workItemId: item.id,
    studentMinutes,
    planningMinutes,
    rangeLowMinutes: roundToFive(studentMinutes * clampSpread(percentile(sorted, 0.25))),
    rangeHighMinutes: roundToFive(studentMinutes * clampSpread(percentile(sorted, 0.75))),
    appliedRatio: applied,
    confidence,
    sampleSize: resolved.sampleSize,
    matchLevel: resolved.level,
    adjusted: planningMinutes !== studentMinutes,
    reason: describe(median, resolved.sampleSize, resolved.level),
  };
}

/**
 * A duration suggestion built directly from real recorded time on similar past work — for the one
 * moment `personalizeEstimate` can't help with: an item that has no estimate yet at all, such as
 * externally-imported work waiting on the student (Phase 5C, Part 4).
 *
 * This is not a second estimation system. It reuses the exact same category resolution
 * (type+rigor+subject → type+rigor → type → overall), the same recency window, and the same
 * minimum-sample gate as `personalizeEstimate` — the only difference is reading `actualMinutes`
 * instead of `ratio`, because there is no existing estimate here for a ratio to scale. The student
 * still types the final number themselves; this only informs the guess, and is never applied
 * automatically.
 */
export interface DurationSuggestion {
  /** A realistic spread from the 25th–75th percentile of similar recorded sessions. */
  lowMinutes: number;
  highMinutes: number;
  medianMinutes: number;
  sampleSize: number;
  matchLevel: EstimateMatchLevel;
}

export function suggestDurationFromHistory(
  workType: WorkType,
  history: EstimateHistory,
  rigor?: CourseRigor,
  subject?: string
): DurationSuggestion | null {
  const levels: EstimateMatchLevel[] = ["type-rigor-subject", "type-rigor", "type", "overall"];

  for (const level of levels) {
    const bucket = history.buckets.get(keyFor(level, workType, rigor, subject));
    if (!bucket) continue;
    const recent = [...bucket.samples].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, ESTIMATE_RECENT_WINDOW);
    if (recent.length < ESTIMATE_MIN_SAMPLES) continue;

    const sorted = recent.map((r) => r.actualMinutes).sort((a, b) => a - b);
    return {
      lowMinutes: roundToFive(percentile(sorted, 0.25)),
      medianMinutes: roundToFive(percentile(sorted, 0.5)),
      highMinutes: roundToFive(percentile(sorted, 0.75)),
      sampleSize: recent.length,
      matchLevel: level,
    };
  }
  return null;
}

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { WorkloadStatus } from "@/scheduling-engine";

const TONE: Record<WorkloadStatus["level"], BadgeTone> = {
  ahead: "brand",
  "on-track": "success",
  "getting-tight": "warning",
  "at-risk": "danger",
};

const LABEL: Record<WorkloadStatus["level"], string> = {
  ahead: "Ahead",
  "on-track": "On track",
  "getting-tight": "Getting tight",
  "at-risk": "At risk",
};

/** A single glanceable verdict on how the student's real workload is going (Phase 3A, Part 6). */
export function WorkloadStatusBadge({ status }: { status: WorkloadStatus }) {
  return (
    <div className="flex items-start gap-2">
      <Badge tone={TONE[status.level]} className="mt-0.5 shrink-0">
        {LABEL[status.level]}
      </Badge>
      <p className="text-sm text-ink-muted">{status.message}</p>
    </div>
  );
}

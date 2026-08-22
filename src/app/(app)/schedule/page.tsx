import { PageHeader } from "@/components/layout/PageHeader";
import { SampleDataNote } from "@/components/layout/SampleDataNote";
import { ScheduleBlockCard } from "@/components/schedule/ScheduleBlockCard";

const WEEK = [
  { day: "Mon", blocks: [{ title: "Morning practice", time: "7–8 AM", kind: "commitment" as const }] },
  {
    day: "Tue",
    blocks: [
      { title: "Read Ch. 12", time: "4–4:30 PM", kind: "assignment" as const },
      { title: "Study for Unit 4 Test", time: "4:45–5:45 PM", kind: "test" as const },
    ],
  },
  { day: "Wed", blocks: [{ title: "Morning practice", time: "7–8 AM", kind: "commitment" as const }] },
  { day: "Thu", blocks: [] },
  { day: "Fri", blocks: [{ title: "Lab report draft", time: "6–7 PM", kind: "project" as const }] },
  { day: "Sat", blocks: [] },
  { day: "Sun", blocks: [{ title: "Weekly review", time: "6–6:30 PM", kind: "assignment" as const }] },
];

export default function SchedulePage() {
  return (
    <div>
      <PageHeader
        title="Schedule"
        description="Weekly view. Automatic generation and drag-to-adjust come with the scheduling engine."
      />

      <SampleDataNote />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {WEEK.map((d) => (
          <div key={d.day} className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {d.day}
            </span>
            <div className="flex flex-col gap-2">
              {d.blocks.length === 0 ? (
                <div className="rounded-md border border-dashed border-border-strong px-3 py-4 text-center text-xs text-ink-faint">
                  Nothing planned
                </div>
              ) : (
                d.blocks.map((b) => (
                  <ScheduleBlockCard key={b.title} title={b.title} timeLabel={b.time} kind={b.kind} />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

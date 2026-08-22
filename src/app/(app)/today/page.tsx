import { PageHeader } from "@/components/layout/PageHeader";
import { SampleDataNote } from "@/components/layout/SampleDataNote";
import { ScheduleBlockCard } from "@/components/schedule/ScheduleBlockCard";

export default function TodayPage() {
  return (
    <div>
      <PageHeader
        title="Today"
        description="Your plan for today. Once the scheduling engine is built, this will be generated automatically."
      />

      <section className="rounded-lg border border-border bg-surface p-5">
        <SampleDataNote />
        <div className="flex flex-col gap-2">
          <ScheduleBlockCard title="Morning practice" timeLabel="7:00 – 8:00 AM" kind="commitment" />
          <ScheduleBlockCard title="Read Ch. 12 — Cell Respiration" timeLabel="4:00 – 4:30 PM" kind="assignment" />
          <ScheduleBlockCard title="Study for Unit 4 Test" timeLabel="4:45 – 5:45 PM" kind="test" />
          <ScheduleBlockCard title="Lab report draft" timeLabel="6:00 – 7:00 PM" kind="project" status="completed" />
        </div>
      </section>
    </div>
  );
}

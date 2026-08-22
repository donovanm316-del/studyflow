import { PageHeader } from "@/components/layout/PageHeader";
import { SampleDataNote } from "@/components/layout/SampleDataNote";
import { Button } from "@/components/ui/Button";
import { TaskRow } from "@/components/tasks/TaskRow";

export default function TestsPage() {
  return (
    <div>
      <PageHeader
        title="Tests & Quizzes"
        description="Exams and quizzes, tracked separately so prep time gets weighted correctly."
        action={
          <Button disabled title="Not implemented yet">
            Add test or quiz
          </Button>
        }
      />

      <section className="rounded-lg border border-border bg-surface p-5">
        <SampleDataNote />
        <TaskRow
          title="Unit 4 Test"
          subject="Algebra II"
          dueLabel="Due in 3 days"
          status="not-started"
          kindLabel="Test"
          estimatedMinutes={90}
        />
        <TaskRow
          title="Pop quiz — vocabulary"
          subject="Spanish"
          dueLabel="Due in 1 day"
          status="not-started"
          kindLabel="Quiz"
          estimatedMinutes={15}
        />
        <TaskRow
          title="Midterm exam"
          subject="World History"
          dueLabel="Due in 9 days"
          status="not-started"
          kindLabel="Test"
          estimatedMinutes={150}
        />
      </section>
    </div>
  );
}

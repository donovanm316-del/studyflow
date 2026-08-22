import { PageHeader } from "@/components/layout/PageHeader";
import { SampleDataNote } from "@/components/layout/SampleDataNote";
import { Button } from "@/components/ui/Button";
import { TaskRow } from "@/components/tasks/TaskRow";

export default function AssignmentsPage() {
  return (
    <div>
      <PageHeader
        title="Assignments"
        description="Homework, readings, and other single-sitting work."
        action={
          <Button disabled title="Not implemented yet">
            Add assignment
          </Button>
        }
      />

      <section className="rounded-lg border border-border bg-surface p-5">
        <SampleDataNote />
        <TaskRow
          title="Read Ch. 12 — Cell Respiration"
          subject="Biology"
          dueLabel="Due tomorrow"
          status="not-started"
          kindLabel="Assignment"
          estimatedMinutes={30}
        />
        <TaskRow
          title="Worksheet 6.3"
          subject="Algebra II"
          dueLabel="Due in 2 days"
          status="not-started"
          kindLabel="Assignment"
          estimatedMinutes={20}
        />
        <TaskRow
          title="Response paragraph — Ch. 5"
          subject="English"
          dueLabel="Due in 4 days"
          status="in-progress"
          kindLabel="Assignment"
          estimatedMinutes={45}
        />
        <TaskRow
          title="Vocabulary quiz prep"
          subject="Spanish"
          dueLabel="Completed Aug 18"
          status="completed"
          kindLabel="Assignment"
          estimatedMinutes={25}
        />
      </section>
    </div>
  );
}

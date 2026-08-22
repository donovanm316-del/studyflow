import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" description="Account and planning preferences." />

      <div className="flex flex-col gap-6">
        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Profile</h2>
          <p className="mb-4 text-xs text-ink-faint">Placeholder — not yet connected to an account.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" placeholder="Alex Rivera" disabled />
            <Input label="Email" type="email" placeholder="you@school.edu" disabled />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-ink">Grade level</label>
              <select
                disabled
                className="h-10 rounded-md border border-border-strong bg-surface px-3 text-sm text-ink-faint"
              >
                <option>High school</option>
              </select>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Planning preferences</h2>
          <p className="mb-4 text-xs text-ink-faint">
            Placeholder — will drive the scheduling engine once it&apos;s built.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Preferred session length (minutes)"
              type="number"
              placeholder="45"
              disabled
            />
            <Input
              label="Buffer days before due date"
              type="number"
              placeholder="1"
              disabled
            />
            <Input label="Earliest work time" type="time" defaultValue="15:30" disabled />
            <Input label="Latest work time" type="time" defaultValue="21:00" disabled />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5">
          <h2 className="mb-1 text-sm font-semibold text-ink">Connections</h2>
          <p className="mb-4 text-xs text-ink-faint">
            Google Classroom import is planned for a future phase and is not available yet.
          </p>
          <Button variant="secondary" disabled>
            Connect Google Classroom
          </Button>
        </section>
      </div>
    </div>
  );
}

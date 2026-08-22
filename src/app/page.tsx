import Link from "next/link";
import { Button } from "@/components/ui/Button";

const FEATURES = [
  {
    title: "See your real workload",
    description:
      "Assignments, tests, quizzes, and projects in one place, instead of scattered across syllabi and apps.",
  },
  {
    title: "Realistic daily plans",
    description:
      "A schedule built around the time you actually have, including practice, clubs, and everything else on your plate.",
  },
  {
    title: "Plans that adapt",
    description:
      "When something changes — a missed session, a moved due date — the plan adjusts instead of falling apart.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
          <span className="text-sm font-semibold tracking-tight text-ink">StudyFlow</span>
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost" size="sm">Log in</Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">Sign up</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Time management that actually fits a student&apos;s week.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-ink-muted">
            StudyFlow turns your assignments, tests, and commitments into a plan you can
            actually follow — and helps you get better at estimating your own time.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href="/signup">
              <Button>Get started</Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="secondary">View dashboard demo</Button>
            </Link>
          </div>
        </section>

        <section className="border-t border-border bg-surface">
          <div className="mx-auto grid max-w-5xl gap-8 px-6 py-16 sm:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold text-ink">{feature.title}</h2>
                <p className="text-sm text-ink-muted">{feature.description}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-6">
        <p className="mx-auto max-w-5xl text-xs text-ink-faint">
          StudyFlow is in early development. Scheduling and account features are placeholders.
        </p>
      </footer>
    </div>
  );
}

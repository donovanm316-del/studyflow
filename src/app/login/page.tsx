import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function LoginPage() {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link href="/" className="text-sm font-semibold tracking-tight text-ink">
            StudyFlow
          </Link>
          <h1 className="mt-4 text-lg font-semibold text-ink">Log in</h1>
        </div>

        <form className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
          <Input label="Email" type="email" placeholder="you@school.edu" disabled />
          <Input label="Password" type="password" placeholder="••••••••" disabled />
          <Button type="button" disabled className="mt-2">
            Log in (not yet functional)
          </Button>
          <p className="text-center text-xs text-ink-faint">
            Authentication is not implemented in this phase — this form is a placeholder.
          </p>
        </form>

        <p className="mt-4 text-center text-sm text-ink-muted">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-medium text-brand hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

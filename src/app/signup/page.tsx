import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function SignupPage() {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link href="/" className="text-sm font-semibold tracking-tight text-ink">
            StudyFlow
          </Link>
          <h1 className="mt-4 text-lg font-semibold text-ink">Create an account</h1>
        </div>

        <form className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
          <Input label="Full name" placeholder="Alex Rivera" disabled />
          <Input label="Email" type="email" placeholder="you@school.edu" disabled />
          <Input label="Password" type="password" placeholder="••••••••" disabled />
          <Button type="button" disabled className="mt-2">
            Sign up (not yet functional)
          </Button>
          <p className="text-center text-xs text-ink-faint">
            Account creation is not implemented in this phase — this form is a placeholder.
          </p>
        </form>

        <p className="mt-4 text-center text-sm text-ink-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

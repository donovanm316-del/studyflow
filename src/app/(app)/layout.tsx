import { Sidebar } from "@/components/layout/Sidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { OnboardingGate } from "@/components/layout/OnboardingGate";
import { StorageWarningBanner } from "@/components/layout/StorageWarningBanner";

/** `AppDataProvider` lives in the root layout now (`src/app/layout.tsx`) so `/onboarding` — which
 *  sits outside this `(app)` route group — shares the exact same data instance, not a second one. */
export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav />
        <StorageWarningBanner />
        <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-5xl">
            <OnboardingGate>{children}</OnboardingGate>
          </div>
        </main>
      </div>
    </div>
  );
}

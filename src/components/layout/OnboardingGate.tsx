"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/lib/data/store";

/**
 * Sends a genuine first-time visitor to `/onboarding` instead of the app shell (Phase 3B,
 * Part 1/2). Waits for `hydrated` — the real value of `onboardingComplete` isn't known until
 * client-side data has loaded, and redirecting before then would either flash the wrong thing or
 * (worse) send an existing user with real data into onboarding by mistake.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { hydrated, onboardingComplete } = useAppData();
  const router = useRouter();

  useEffect(() => {
    if (hydrated && !onboardingComplete) router.replace("/onboarding");
  }, [hydrated, onboardingComplete, router]);

  if (hydrated && !onboardingComplete) return null;
  return <>{children}</>;
}

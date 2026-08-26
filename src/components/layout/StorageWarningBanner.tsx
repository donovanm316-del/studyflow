"use client";

import { useAppData } from "@/lib/data/store";

/** Honest, non-blocking notice when local persistence has failed (Phase 3B, Part 18). */
export function StorageWarningBanner() {
  const { storageWarning } = useAppData();
  if (!storageWarning) return null;

  return (
    <div className="border-b border-warning-soft bg-warning-soft px-4 py-2 text-center text-xs text-warning sm:px-6 md:px-8">
      Your changes aren&apos;t being saved on this device right now (storage is full or unavailable, e.g. private
      browsing). Everything still works, but it won&apos;t be here after you reload.
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-items";
import { Logo } from "./Logo";

/**
 * Mobile menu toggle (Phase 5D, Part 9). 44px is the minimum comfortable touch target on a phone
 * (iOS/Android guidance both land here) — the previous 36px (`h-9 w-9`) button was legible but
 * fiddly to actually tap.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Escape closes the menu and returns focus to the toggle, matching standard disclosure-menu
  // behavior (Part 9/22). Only listens while the menu is actually open.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="border-b border-border bg-surface md:hidden [padding-top:env(safe-area-inset-top)]">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
          <Logo className="h-6 w-6 rounded-md" />
          StudyFlow
        </Link>
        <button
          ref={toggleRef}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="mobile-nav-menu"
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          className="flex h-11 w-11 items-center justify-center rounded-md text-ink hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          <span className="text-xl leading-none" aria-hidden>
            {open ? "✕" : "☰"}
          </span>
        </button>
      </div>
      {open && (
        <nav id="mobile-nav-menu" aria-label="Primary" className="flex flex-col gap-0.5 border-t border-border p-3">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-md px-3 py-3 text-sm font-medium",
                  active ? "bg-brand-soft text-brand-strong" : "text-ink-muted hover:bg-paper hover:text-ink"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}

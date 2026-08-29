"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-items";
import { Logo } from "./Logo";

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border bg-surface md:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/dashboard" className="flex items-center gap-2 text-sm font-semibold tracking-tight text-ink">
          <Logo className="h-6 w-6 rounded-md" />
          StudyFlow
        </Link>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Toggle navigation"
          className="flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-paper"
        >
          <span className="text-lg leading-none">{open ? "✕" : "☰"}</span>
        </button>
      </div>
      {open && (
        <nav className="flex flex-col gap-0.5 border-t border-border p-3">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium",
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

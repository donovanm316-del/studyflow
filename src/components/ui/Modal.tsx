"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * A minimal, dependency-free dialog. Closes on Escape or backdrop click.
 * Not a full focus-trap implementation — sufficient for Phase 1A's placeholder
 * usage (e.g. "add assignment" forms come later).
 */
export function Modal({ open, onClose, title, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      {/*
        The dialog is capped to the viewport and scrolls internally. Without this, a form taller
        than the screen is clipped at *both* ends by the centering above — on a phone that hid the
        work item form's own Save/Cancel buttons entirely, making it impossible to submit.
        `dvh` rather than `vh` so mobile browser chrome collapsing doesn't re-clip it.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-lg border border-border bg-surface shadow-lg",
          className
        )}
      >
        {/* Header stays put while the body scrolls, so the close button is always reachable. */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h2 id="modal-title" className="text-base font-semibold text-ink">
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-muted hover:bg-paper hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

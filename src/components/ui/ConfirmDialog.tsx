"use client";

import { Modal } from "./Modal";
import { Button } from "./Button";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  /** Red/destructive styling for the confirm button — use for actions that lose data (Phase 3B, Part 17). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A reusable confirmation dialog for actions that would cause meaningful, hard-to-undo data loss. */
export function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", danger, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="text-sm text-ink-muted">{description}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

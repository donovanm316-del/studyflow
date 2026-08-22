import { InputHTMLAttributes, LabelHTMLAttributes, forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, error, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-ink">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "h-10 rounded-md border bg-surface px-3 text-sm text-ink placeholder:text-ink-faint",
            "focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent",
            error ? "border-danger" : "border-border-strong",
            className
          )}
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${inputId}-note` : undefined}
          {...props}
        />
        {(error || hint) && (
          <span
            id={`${inputId}-note`}
            className={cn("text-xs", error ? "text-danger" : "text-ink-muted")}
          >
            {error ?? hint}
          </span>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";

export function FieldLabel(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className="text-sm font-medium text-ink" {...props} />;
}

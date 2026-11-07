import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { bodyText, iconSize, type Mode } from "../lib/mode";
import { cn } from "../lib/utils";
import { Icon } from "./icon";
import { Label } from "./label";

export const inputVariants = cva(
  [
    "vbt-input-field w-full rounded-sm bg-surface-sunk text-ink placeholder:text-ink-muted",
    // A control edge is line-strong (3:1 on every surface).
    "border border-line-strong",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    // aria-invalid="true" shows the discarded color as a ring.
    "aria-invalid:border-status-discarded aria-invalid:ring-2 aria-invalid:ring-status-discarded",
    "disabled:cursor-not-allowed disabled:opacity-50",
  ],
  {
    variants: {
      mode: {
        voter: "min-h-11 px-4 py-2 text-body-lg",
        admin: "min-h-9 px-3 py-1 text-body",
      },
      variant: {
        text: "font-sans",
        // Tracking codes: mono so 0/O and 1/l/I differ.
        code: "font-mono",
      },
    },
    compoundVariants: [
      { variant: "code", mode: "voter", className: "text-code-lg" },
      { variant: "code", mode: "admin", className: "text-code" },
    ],
    defaultVariants: { mode: "voter", variant: "text" },
  },
);

export type InputProps = Omit<ComponentProps<"input">, "id"> & {
  /** Required so the label and messages can be linked without client-side id generation. */
  id: string;
  label: string;
  hint?: string;
  /** An error sentence that says what happened and what to do. Sets aria-invalid. */
  error?: string;
  mode?: Mode;
  variant?: "text" | "code";
};

/** A labeled text field: label, input, optional hint and error. */
export function Input({
  id,
  label,
  hint,
  error,
  mode = "voter",
  variant = "text",
  className,
  "aria-invalid": ariaInvalid,
  ...props
}: InputProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const invalid = ariaInvalid ?? (error ? true : undefined);
  const text = bodyText(mode);

  return (
    <div data-component="input" data-mode={mode} className={cn("vbt-input flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={cn(inputVariants({ mode, variant }))}
        {...(variant === "code" ? { autoComplete: "off", autoCapitalize: "characters", spellCheck: false } : {})}
        {...props}
      />
      {hint ? (
        <p id={hintId} className={cn(text, "text-ink-muted")}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={cn(text, "flex items-start gap-2 text-status-discarded")}>
          <Icon name="x-circle" size={iconSize(mode)} className="mt-1" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

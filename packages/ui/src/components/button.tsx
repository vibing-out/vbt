import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

export const buttonVariants = cva(
  [
    "vbt-button inline-flex items-center justify-center gap-2 rounded-sm font-semibold",
    "transition-shadow cursor-pointer select-none",
    // Every interactive element: 2px solid focus ring at 2px offset.
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        // brand-orange is a fill, with on-accent text (5.3:1 light, 6.4:1 dark).
        primary: "bg-brand-orange text-on-accent hover:shadow-card",
        // Control edges use line-strong, never line.
        secondary: "bg-surface-raised text-ink border border-line-strong hover:bg-surface-sunk",
      },
      mode: {
        // Voter targets are at least 44px tall.
        voter: "min-h-11 px-6 py-2 text-body-lg",
        admin: "min-h-9 px-4 py-1 text-body",
      },
      // On surface-inverse the focus token is too dark to see (2.5:1 light); focus-inverse is made for it.
      inverse: {
        true: "focus-visible:outline-focus-inverse",
        false: "",
      },
    },
    defaultVariants: { variant: "primary", mode: "voter", inverse: false },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (a link, say) with button styles instead of a <button>. */
    asChild?: boolean;
  };

export function Button({ className, variant, mode, inverse, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-component="button"
      data-mode={mode ?? "voter"}
      data-variant={variant ?? "primary"}
      className={cn(buttonVariants({ variant, mode, inverse }), className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
}

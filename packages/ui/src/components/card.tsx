import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { bodyText, type Mode } from "../lib/mode";
import { cn } from "../lib/utils";

// Cards separate by elevation and surface, not borders.
export const cardVariants = cva("vbt-card flex flex-col gap-4 p-4 md:p-6", {
  variants: {
    variant: {
      default: "bg-surface-raised text-ink rounded-md shadow-card",
      // One dark hero per screen.
      hero: [
        "vbt-card-hero bg-surface-inverse text-on-inverse rounded-lg shadow-overlay",
        "[&_[data-slot=card-description]]:text-on-inverse-muted",
      ],
    },
  },
  defaultVariants: { variant: "default" },
});

export type CardProps = ComponentProps<"div"> & VariantProps<typeof cardVariants> & { mode?: Mode };

export function Card({ className, variant, mode = "voter", ...props }: CardProps) {
  return (
    <div
      data-component="card"
      data-mode={mode}
      data-variant={variant ?? "default"}
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("flex flex-col gap-1", className)} {...props} />;
}

export function CardTitle({ className, mode = "voter", ...props }: ComponentProps<"h3"> & { mode?: Mode }) {
  return (
    <h3
      data-slot="card-title"
      className={cn(mode === "admin" ? "text-heading" : "text-title", className)}
      {...props}
    />
  );
}

export function CardDescription({ className, mode = "voter", ...props }: ComponentProps<"p"> & { mode?: Mode }) {
  return <p data-slot="card-description" className={cn(bodyText(mode), "text-ink-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("flex flex-col gap-3", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex flex-wrap items-center gap-3", className)} {...props} />;
}

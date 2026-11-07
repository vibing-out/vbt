import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

/** Uppercase `label` style field label (13px, 600, 0.04em tracking). */
export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("vbt-label text-label uppercase text-ink", className)} {...props} />;
}

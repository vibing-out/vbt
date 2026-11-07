import type { ComponentProps } from "react";
import type { Mode } from "../lib/mode";
import { cn } from "../lib/utils";
import { BADGE_LABELS, STATUS_ICONS, type BallotStatus } from "../status";
import { Icon } from "./icon";

export interface StatusBadgeProps {
  status: BallotStatus;
  mode?: Mode;
  /** Replaces the default label (for Spanish strings, say). */
  label?: string;
  className?: string;
}

interface Variant {
  dot: string;
  fill: string;
  text: string;
}

/** StatusBadge README, Variants: dot, fill and text per status. */
export const BADGE_VARIANTS: Record<BallotStatus, Variant> = {
  CAST: { dot: "bg-ink-muted", fill: "bg-surface-sunk", text: "text-ink" },
  TALLIED_PRECINCT: { dot: "bg-ink", fill: "bg-surface-sunk", text: "text-ink" },
  REPORTED_UNOFFICIAL: { dot: "bg-accent-mark", fill: "bg-accent-tint", text: "text-ink" },
  CERTIFIED: { dot: "bg-ink", fill: "bg-stage-done", text: "text-ink" },
  CHALLENGED: { dot: "bg-status-challenged", fill: "bg-status-challenged-bg", text: "text-status-challenged" },
  DISCARDED: { dot: "bg-status-discarded", fill: "bg-status-discarded-bg", text: "text-status-discarded" },
  SPOILED: { dot: "bg-status-spoiled", fill: "bg-status-spoiled-bg", text: "text-status-spoiled" },
};

// radius-pill, space-1 vertical and space-2 horizontal padding, no border, space-1 from dot to
// label. Never wraps or truncates: the row grows instead. Cross-fades over duration-base.
const BASE = [
  "vbt-badge inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-1 whitespace-nowrap",
  "transition-colors duration-base ease-out motion-reduce:transition-none",
];

// Voter: 14px weight 600. Admin: small weight 500.
const SIZE: Record<Mode, string> = { voter: "text-small font-semibold", admin: "text-small font-medium" };

/** A pill naming a ballot's status: an 8px dot (or, in admin, the status icon) plus the word. */
export function StatusBadge({ status, mode = "voter", label, className }: StatusBadgeProps) {
  const variant = BADGE_VARIANTS[status];
  const icon = mode === "admin" ? STATUS_ICONS[status] : undefined;
  return (
    <span
      data-component="status-badge"
      data-status={status}
      data-mode={mode}
      className={cn(BASE, SIZE[mode], variant.fill, variant.text, className)}
    >
      {icon ? (
        <Icon name={icon} size={14} />
      ) : (
        <span data-slot="dot" aria-hidden="true" className={cn("size-2 shrink-0 rounded-pill", variant.dot)} />
      )}
      <span className="sr-only">Status: </span>
      {label ?? BADGE_LABELS[mode][status]}
    </span>
  );
}

/** Filter chips and labels that are not a status ("Uploaded Nov 3", "Signed in with MFA"). No dot. */
export function PlainBadge({ className, mode = "voter", ...props }: ComponentProps<"span"> & { mode?: Mode }) {
  return (
    <span
      data-component="badge"
      data-variant="plain"
      data-mode={mode}
      className={cn(BASE, SIZE[mode], "bg-surface-sunk text-ink", className)}
      {...props}
    />
  );
}

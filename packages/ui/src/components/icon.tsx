import { Check, Copy, Download, Flag, ScanLine, ShieldCheck, Undo2, X, type LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * Icons by meaning (design system README, Icons). Each has one fixed meaning: check (completed
 * stage, check passed), flag (challenged), x (discarded, check failed; also close), undo-2
 * (spoiled), shield-check (proof), download (download record), scan-line (scan). copy is the
 * Copy code action.
 */
export const ICONS = {
  check: Check,
  flag: Flag,
  x: X,
  "undo-2": Undo2,
  "shield-check": ShieldCheck,
  download: Download,
  "scan-line": ScanLine,
  copy: Copy,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** Lucide at 1.5px stroke (design system README, Icons). */
export const ICON_STROKE_WIDTH = 1.5;

export interface IconProps {
  name: IconName;
  /** 20 in voter mode, 16 in admin mode, 14 in admin badges, 12 cut out of a 16px timeline dot. */
  size?: 12 | 14 | 16 | 20;
  className?: string;
}

/** A decorative Lucide icon, colored like the text beside it. */
export function Icon({ name, size = 20, className }: IconProps) {
  const Component = ICONS[name];
  return (
    <Component
      data-icon={name}
      size={size}
      strokeWidth={ICON_STROKE_WIDTH}
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    />
  );
}

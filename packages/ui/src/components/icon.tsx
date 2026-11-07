import {
  BadgeCheck,
  ChartNoAxesColumnIncreasing,
  Check,
  CircleX,
  Clock,
  Copy,
  Flag,
  Lock,
  RotateCcw,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/utils";

/** Icons by meaning (design system README, Iconography). Names match the StatusBadge README's data-icon values. */
export const ICONS = {
  lock: Lock,
  check: Check,
  chart: ChartNoAxesColumnIncreasing,
  "badge-check": BadgeCheck,
  flag: Flag,
  "x-circle": CircleX,
  "rotate-ccw": RotateCcw,
  "shield-check": ShieldCheck,
  clock: Clock,
  copy: Copy,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  /** 20 in voter mode, 16 in admin mode and inside badges. */
  size?: 16 | 20;
  className?: string;
}

/** A decorative Lucide icon at stroke 1.75, colored like the text beside it. */
export function Icon({ name, size = 20, className }: IconProps) {
  const Component = ICONS[name];
  return (
    <Component
      data-icon={name}
      size={size}
      strokeWidth={1.75}
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    />
  );
}

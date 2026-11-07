import type { ComponentProps } from "react";
import type { Mode } from "../lib/mode";
import { cn } from "../lib/utils";
import {
  STATUS_ICONS,
  isStage,
  needsReason,
  statusLabel,
  type BallotStatus,
  type ReasonStatus,
  type Stage,
} from "../status";
import { Icon, type IconName } from "./icon";

/** done: a completed stage. current: the stage the ballot is at. pending: waiting or in progress (admin). */
export type BadgeState = "done" | "current" | "pending";

interface BaseProps {
  mode?: Mode;
  /** Replaces the default label (for Spanish strings, say). */
  label?: string;
  /** Shown after a middle dot, in regular weight: a date or a short note. Never a time of day for Cast. */
  detail?: string;
  className?: string;
}

type StageBadgeProps = BaseProps & { status: Stage; state?: BadgeState; reason?: never };
/** Challenged and Discarded always carry their reason. */
type ReasonBadgeProps = BaseProps & { status: ReasonStatus; reason: string; state?: never };
type SpoiledBadgeProps = BaseProps & { status: "SPOILED"; reason?: string; state?: never };

export type StatusBadgeProps = StageBadgeProps | ReasonBadgeProps | SpoiledBadgeProps;

const BASE = "vbt-badge inline-flex max-w-full items-center gap-2 rounded-pill px-3 py-1 font-semibold";

const STATE_CLASSES: Record<BadgeState, string> = {
  done: "bg-stage-done text-ink",
  current: "bg-accent-tint text-accent-text",
  pending: "bg-surface-sunk text-ink-muted",
};

const OFF_PATH_CLASSES: Record<Exclude<BallotStatus, Stage>, string> = {
  CHALLENGED: "bg-status-challenged-bg text-status-challenged",
  DISCARDED: "bg-status-discarded-bg text-status-discarded",
  SPOILED: "bg-status-spoiled-bg text-status-spoiled",
};

function textFor(mode: Mode): string {
  return mode === "admin" ? "text-small" : "text-body-lg";
}

/** A soft pill with an icon, the status word and an optional detail: never color alone. */
export function StatusBadge(props: StatusBadgeProps) {
  const { status, mode = "voter", label, detail, className } = props;
  const reason = props.reason?.trim() || undefined;

  if (needsReason(status) && !reason && process.env.NODE_ENV !== "production") {
    throw new Error(`StatusBadge: ${status} must show its reason`);
  }

  const state: BadgeState | undefined = isStage(status) ? (props.state ?? "done") : undefined;
  const tone = state ? STATE_CLASSES[state] : OFF_PATH_CLASSES[status as Exclude<BallotStatus, Stage>];
  const icon: IconName = state === "pending" ? "clock" : STATUS_ICONS[status];
  const shownDetail = reason ?? detail;

  return (
    <span
      data-component="status-badge"
      data-status={status}
      data-state={state}
      data-mode={mode}
      className={cn(BASE, textFor(mode), tone, className)}
    >
      {/* Badge icons are 16px in both modes (StatusBadge README). */}
      <Icon name={icon} size={16} />
      <span>
        {label ?? statusLabel(status, mode)}
        {shownDetail ? <span className="font-normal">{` · ${shownDetail}`}</span> : null}
      </span>
    </span>
  );
}

/** Filter chips and labels that are not a status ("Uploaded tonight", "Signed in with MFA"). No icon. */
export function PlainBadge({ className, mode = "voter", ...props }: ComponentProps<"span"> & { mode?: Mode }) {
  return (
    <span
      data-component="badge"
      data-variant="plain"
      data-mode={mode}
      className={cn(BASE, textFor(mode), "bg-surface-sunk text-ink", className)}
      {...props}
    />
  );
}

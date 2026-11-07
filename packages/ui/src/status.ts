// Presentation of ballot statuses: labels, icons and grouping. No transition rules live here;
// those belong to packages/domain (T-02). The codes and public labels are the locked
// "Ballot status state machine" in docs/locked-interfaces.md. When packages/domain lands,
// BallotStatus should be replaced by its type.

import type { IconName } from "./components/icon";

export const BALLOT_STATUSES = [
  "CAST",
  "TALLIED_PRECINCT",
  "REPORTED_UNOFFICIAL",
  "CERTIFIED",
  "CHALLENGED",
  "DISCARDED",
  "SPOILED",
] as const;

export type BallotStatus = (typeof BALLOT_STATUSES)[number];

/** The four stages on the path, in their fixed display order. */
export const STAGES = ["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED"] as const;
export type Stage = (typeof STAGES)[number];

/** Statuses off the four-stage path. */
export const OFF_PATH_STATUSES = ["CHALLENGED", "DISCARDED", "SPOILED"] as const;
export type OffPathStatus = (typeof OFF_PATH_STATUSES)[number];

/** Statuses that are always shown with their reason (design system README, Principles). */
export const REASON_STATUSES = ["CHALLENGED", "DISCARDED"] as const;
export type ReasonStatus = (typeof REASON_STATUSES)[number];

/** Voter mode: the locked public labels. DISCARDED's "(reason shown)" is the required reason detail. */
export const VOTER_LABELS: Record<BallotStatus, string> = {
  CAST: "Cast and sealed",
  TALLIED_PRECINCT: "Counted at precinct",
  REPORTED_UNOFFICIAL: "Included in election-night results",
  CERTIFIED: "Included in certified results",
  CHALLENGED: "Under review",
  DISCARDED: "Not counted",
  SPOILED: "Spoiled by voter to check the machine; not counted",
};

/** Admin mode: compact labels for dense tables (StatusBadge README). */
export const ADMIN_LABELS: Record<BallotStatus, string> = {
  CAST: "Cast",
  TALLIED_PRECINCT: "Counted",
  REPORTED_UNOFFICIAL: "Election night",
  CERTIFIED: "Certified",
  CHALLENGED: "Challenged",
  DISCARDED: "Discarded",
  SPOILED: "Spoiled",
};

/** Fixed icon meanings (design system README, Iconography). */
export const STATUS_ICONS: Record<BallotStatus, IconName> = {
  CAST: "lock",
  TALLIED_PRECINCT: "check",
  REPORTED_UNOFFICIAL: "chart",
  CERTIFIED: "badge-check",
  CHALLENGED: "flag",
  DISCARDED: "x-circle",
  SPOILED: "rotate-ccw",
};

export function isStage(status: BallotStatus): status is Stage {
  return (STAGES as readonly string[]).includes(status);
}

export function needsReason(status: BallotStatus): status is ReasonStatus {
  return (REASON_STATUSES as readonly string[]).includes(status);
}

export function statusLabel(status: BallotStatus, mode: "voter" | "admin"): string {
  return mode === "admin" ? ADMIN_LABELS[status] : VOTER_LABELS[status];
}

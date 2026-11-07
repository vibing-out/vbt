// Presentation of ballot statuses: labels, icons and grouping. No transition rules live here;
// those belong to packages/domain (T-02). The codes and public labels are the locked
// "Ballot status state machine" in docs/locked-interfaces.md. When packages/domain lands,
// BallotStatus should be replaced by its type.

import type { IconName } from "./components/icon";
import type { Mode } from "./lib/mode";

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

/** The locked public labels, for sentences and headlines. DISCARDED's "(reason shown)" is the required reason detail. */
export const VOTER_LABELS: Record<BallotStatus, string> = {
  CAST: "Cast and sealed",
  TALLIED_PRECINCT: "Counted at precinct",
  REPORTED_UNOFFICIAL: "Included in election-night results",
  CERTIFIED: "Included in certified results",
  CHALLENGED: "Under review",
  DISCARDED: "Not counted",
  SPOILED: "Spoiled by voter to check the machine; not counted",
};

/**
 * StatusBadge labels by mode. Voter: the locked public labels (VOTER_LABELS). Admin: the compact
 * StatusBadge README labels (Variants).
 */
export const BADGE_LABELS: Record<Mode, Record<BallotStatus, string>> = {
  voter: VOTER_LABELS,
  admin: {
    CAST: "Cast",
    TALLIED_PRECINCT: "Counted at precinct",
    REPORTED_UNOFFICIAL: "Election-night results",
    CERTIFIED: "Certified",
    CHALLENGED: "Under review",
    DISCARDED: "Not counted",
    SPOILED: "Spoiled",
  },
};

/**
 * StageTimeline stage labels by mode. Voter: the locked public labels (VOTER_LABELS). Admin: the
 * StageTimeline README labels (Stages).
 */
export const STAGE_LABELS: Record<Mode, Record<Stage, string>> = {
  voter: {
    CAST: VOTER_LABELS.CAST,
    TALLIED_PRECINCT: VOTER_LABELS.TALLIED_PRECINCT,
    REPORTED_UNOFFICIAL: VOTER_LABELS.REPORTED_UNOFFICIAL,
    CERTIFIED: VOTER_LABELS.CERTIFIED,
  },
  admin: {
    CAST: "Cast and sealed",
    TALLIED_PRECINCT: "Counted at precinct",
    REPORTED_UNOFFICIAL: "Election-night results",
    CERTIFIED: "Certified",
  },
};

/**
 * Status icons (StatusBadge README "Icon (admin)" column; design system README, Icons). Statuses
 * without an icon show only their dot.
 */
export const STATUS_ICONS: Partial<Record<BallotStatus, IconName>> = {
  CERTIFIED: "check",
  CHALLENGED: "flag",
  DISCARDED: "x",
  SPOILED: "undo-2",
};

export function isStage(status: BallotStatus): status is Stage {
  return (STAGES as readonly string[]).includes(status);
}

export function needsReason(status: BallotStatus): status is ReasonStatus {
  return (REASON_STATUSES as readonly string[]).includes(status);
}

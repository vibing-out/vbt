// Ballot statuses, voter-facing labels and terminal flags.
// Source: docs/locked-interfaces.md § Ballot status state machine.

export const BALLOT_STATUSES = Object.freeze([
  "CAST",
  "TALLIED_PRECINCT",
  "REPORTED_UNOFFICIAL",
  "CERTIFIED",
  "CHALLENGED",
  "DISCARDED",
  "SPOILED",
] as const);

export type BallotStatus = (typeof BALLOT_STATUSES)[number];

const PUBLIC_LABELS: Readonly<Record<BallotStatus, string>> = {
  CAST: "Cast and sealed",
  TALLIED_PRECINCT: "Counted at precinct",
  REPORTED_UNOFFICIAL: "Included in election-night results",
  CERTIFIED: "Included in certified results",
  CHALLENGED: "Under review",
  DISCARDED: "Not counted (reason shown)",
  SPOILED: "Spoiled by voter to check the machine; not counted",
};

const TERMINAL_STATUSES: ReadonlySet<BallotStatus> = new Set<BallotStatus>([
  "CERTIFIED",
  "DISCARDED",
  "SPOILED",
]);

const STATUS_SET: ReadonlySet<string> = new Set<string>(BALLOT_STATUSES);

/** Runtime guard for values arriving from outside the type system. */
export function isBallotStatus(value: unknown): value is BallotStatus {
  return typeof value === "string" && STATUS_SET.has(value);
}

/** The voter-facing label for a status, exactly as locked. */
export function publicLabel(status: BallotStatus): string {
  return PUBLIC_LABELS[status];
}

/** True when no transition may leave this status. */
export function isTerminal(status: BallotStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

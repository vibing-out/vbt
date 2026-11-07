// Ballot status transition rules.
// Source: docs/locked-interfaces.md § Ballot status state machine.
// Any move not listed in TRANSITIONS is rejected.

import { type BallotStatus, isBallotStatus, isTerminal } from "./status.ts";

export type BatchScope = "precinct" | "county";

export const BATCH_SCOPES: readonly BatchScope[] = ["precinct", "county"];

export type TransitionRule = {
  readonly from: BallotStatus;
  readonly to: BallotStatus;
  /** Batch scope for batch edges; null for single-ballot edges. */
  readonly batch: BatchScope | null;
  /** Resolving a challenge as accepted: `to` must equal the held status. */
  readonly requiresHeldStatus: boolean;
  /** Resolving a challenge as rejected: a non-empty reason is required. */
  readonly requiresReason: boolean;
};

function rule(
  from: BallotStatus,
  to: BallotStatus,
  options: Partial<Pick<TransitionRule, "batch" | "requiresHeldStatus" | "requiresReason">> = {},
): TransitionRule {
  return Object.freeze({
    from,
    to,
    batch: options.batch ?? null,
    requiresHeldStatus: options.requiresHeldStatus ?? false,
    requiresReason: options.requiresReason ?? false,
  });
}

/** Statuses a ballot can be challenged from, and so can return to. */
export const CHALLENGEABLE_STATUSES: readonly BallotStatus[] = Object.freeze([
  "CAST",
  "TALLIED_PRECINCT",
  "REPORTED_UNOFFICIAL",
]);

/** The complete transition table. Nothing outside it is allowed. */
export const TRANSITIONS: readonly TransitionRule[] = Object.freeze([
  rule("CAST", "TALLIED_PRECINCT", { batch: "precinct" }),
  rule("TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", { batch: "county" }),
  rule("REPORTED_UNOFFICIAL", "CERTIFIED", { batch: "county" }),
  ...CHALLENGEABLE_STATUSES.map((s) => rule(s, "CHALLENGED")),
  ...CHALLENGEABLE_STATUSES.map((s) => rule("CHALLENGED", s, { requiresHeldStatus: true })),
  rule("CHALLENGED", "DISCARDED", { requiresReason: true }),
  rule("CAST", "SPOILED"),
]);

export type TransitionErrorCode =
  | "INVALID_STATUS"
  | "INVALID_TRANSITION"
  | "REASON_REQUIRED"
  | "HELD_STATUS_REQUIRED"
  | "INVALID_HELD_STATUS"
  | "HELD_STATUS_MISMATCH"
  | "NOT_BATCH_TRANSITION"
  | "INVALID_BATCH_SCOPE";

export type TransitionResult =
  | { ok: true; status: BallotStatus }
  | { ok: false; code: TransitionErrorCode; message: string };

export type TransitionInput = {
  from: BallotStatus;
  to: BallotStatus;
  /** Required when `to` is DISCARDED. Shown to the voter. */
  reason?: string;
  /** Required when resolving CHALLENGED as accepted: the status held before the challenge. */
  heldStatus?: BallotStatus;
};

export type BatchTransitionInput = {
  from: BallotStatus;
  to: BallotStatus;
  scope: BatchScope;
};

function fail(code: TransitionErrorCode, message: string): TransitionResult {
  return { ok: false, code, message };
}

/** The rule for a move, or undefined when the move is not allowed. */
export function findRule(from: BallotStatus, to: BallotStatus): TransitionRule | undefined {
  return TRANSITIONS.find((r) => r.from === from && r.to === to);
}

/**
 * Validates a single-ballot status change. Returns a result, never throws.
 * Batch edges are accepted here without batch metadata; use
 * validateBatchTransition to check a batch's scope.
 */
export function transition(input: TransitionInput): TransitionResult {
  const { from, to, reason, heldStatus } = input;

  if (!isBallotStatus(from) || !isBallotStatus(to)) {
    return fail("INVALID_STATUS", `Unknown ballot status: ${String(isBallotStatus(from) ? to : from)}`);
  }

  const found = findRule(from, to);
  if (!found) {
    const why = isTerminal(from) ? ` (${from} is terminal)` : "";
    return fail("INVALID_TRANSITION", `Transition ${from} -> ${to} is not allowed${why}`);
  }

  if (found.requiresReason && (typeof reason !== "string" || reason.trim() === "")) {
    return fail("REASON_REQUIRED", `Transition ${from} -> ${to} requires a reason`);
  }

  if (found.requiresHeldStatus) {
    if (heldStatus === undefined) {
      return fail("HELD_STATUS_REQUIRED", `Resolving ${from} as accepted requires the status held before the challenge`);
    }
    if (!CHALLENGEABLE_STATUSES.includes(heldStatus)) {
      return fail("INVALID_HELD_STATUS", `${String(heldStatus)} cannot be the status held before a challenge`);
    }
    if (heldStatus !== to) {
      return fail("HELD_STATUS_MISMATCH", `A challenge resolved as accepted returns to ${heldStatus}, not ${to}`);
    }
  }

  return { ok: true, status: to };
}

/**
 * Validates a batch status change: the move must be a batch edge and the
 * scope must match it (precinct close: precinct; county report and
 * certification: county).
 */
export function validateBatchTransition(input: BatchTransitionInput): TransitionResult {
  const { from, to, scope } = input;
  const found = findRule(from, to);

  if (!found || found.batch === null) {
    return fail("NOT_BATCH_TRANSITION", `Transition ${String(from)} -> ${String(to)} is not a batch transition`);
  }
  if (scope !== found.batch) {
    return fail("INVALID_BATCH_SCOPE", `Transition ${from} -> ${to} is batched per ${found.batch}, not ${String(scope)}`);
  }

  return { ok: true, status: to };
}

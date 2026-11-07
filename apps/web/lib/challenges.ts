import "server-only";

import { isBallotStatus, officialMayActOn, transition } from "@vbt/domain";
import { failure, type Outcome } from "./batches";
import type { Official } from "./require-role";
import type { ServiceDb } from "./service-db";

// POST /api/challenges/{id}/resolve (T-09). {id} is the ballot id: a challenge is a ballot at CHALLENGED
// (the locked data model has no challenges table). County and state officials resolve challenges in their
// scope (locked § Event sources: "County election board decisions"):
//   accepted -> back to the status held before the challenge (from_status of the event into CHALLENGED);
//   rejected -> DISCARDED, and a reason is required (it is shown to the voter).
// @vbt/domain transition() decides; the database function re-checks under a row lock.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_REASON = 500;

export interface ResolveInput {
  decision: unknown;
  reason: unknown;
}

export const FORBIDDEN: Outcome = { status: 403, body: { error: "forbidden" } };

export async function resolveChallenge(official: Official, ballotId: string, input: ResolveInput, db: ServiceDb): Promise<Outcome> {
  try {
    if (!UUID.test(ballotId)) return { status: 404, body: { error: "unknown ballot" } };
    const { decision } = input;
    if (decision !== "accepted" && decision !== "rejected") {
      return { status: 400, body: { error: "decision must be accepted or rejected" } };
    }
    if (input.reason !== undefined && input.reason !== null && typeof input.reason !== "string") {
      return { status: 400, body: { error: "reason must be text" } };
    }
    const reason = typeof input.reason === "string" && input.reason.trim() !== "" ? input.reason.trim() : null;
    if (reason !== null && reason.length > MAX_REASON) {
      return { status: 400, body: { error: `reason may be at most ${MAX_REASON} characters` } };
    }
    if (decision === "rejected" && reason === null) {
      return { status: 400, body: { error: "rejecting a challenge requires a reason" } };
    }

    const where = await db.ballotScope(ballotId);
    if (!where) return { status: 404, body: { error: "unknown ballot" } };
    if (!officialMayActOn(official, { scope: "precinct", id: where.precinct_id }, where.county_id)) return FORBIDDEN;
    if (where.current_status !== "CHALLENGED") return { status: 409, body: { error: "the ballot is not challenged" } };

    const to = decision === "rejected" ? "DISCARDED" : where.held_status;
    if (!isBallotStatus(to)) return { status: 409, body: { error: "the status held before the challenge is unknown" } };
    const heldStatus = isBallotStatus(where.held_status) ? where.held_status : undefined;
    const check = transition({ from: "CHALLENGED", to, reason: reason ?? undefined, heldStatus });
    if (!check.ok) {
      return { status: check.code === "REASON_REQUIRED" ? 400 : 409, body: { error: check.message } };
    }

    const status = await db.resolveChallenge(ballotId, check.status, reason, official.role, official.userId);
    return { status: 200, body: { status } };
  } catch (error) {
    const outcome = failure(error);
    return outcome.status === 500 ? { status: 500, body: { error: "resolving the challenge failed; nothing was changed" } } : outcome;
  }
}

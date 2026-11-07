import "server-only";

import { randomUUID } from "node:crypto";
import {
  aggregateDecrypt,
  buildMerkleTree,
  type ContestTotals,
  type InclusionProof,
  signStageRecord,
  type StageRecord,
} from "@vbt/crypto";
import {
  BATCH_SCOPES,
  type BallotStatus,
  type BatchScope,
  isBallotStatus,
  type TransitionErrorCode,
  validateBatchTransition,
} from "@vbt/domain";
import { chainEvent, decodeStandardBase64, indianaDate, sha256Hex, stageLeaf, sortStageLeaves } from "@vbt/events";
import { ELECTION_MANIFEST, type ElectionKeys, loadElectionKeys } from "./election";
import type { Official } from "./require-role";
import { type BatchMember, dbFailure, jsonResponse, serverMisconfigured, serviceDb, type ServiceDb } from "./service-db";

// POST /api/batches (T-05): one batch transition (precinct close, county report, certification).
// TypeScript reads the members and their chain heads, builds every event, the Merkle tree, the
// aggregate totals and the signature, then calls apply_batch once; the RPC re-checks under lock and
// rolls everything back (409) if anything moved meanwhile (C11). The stage record shares the batch's
// id (stage_records.id = batches.id, C16).

type Env = Readonly<Record<string, string | undefined>>;

export const MAX_BATCH_BODY_BYTES = 4096;
const MAX_ID = 128;

export type BatchRequest = { scope: BatchScope; scope_id: string; from_status: string; to_status: string };

/** Structural check of the JSON body (400 when null). Status values are checked later, as 422. */
export function parseBatchRequest(json: unknown): BatchRequest | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const { scope, scope_id, from_status, to_status } = json as Record<string, unknown>;
  if (!BATCH_SCOPES.includes(scope as BatchScope)) return null;
  if (typeof scope_id !== "string" || scope_id.trim() === "" || scope_id.length > MAX_ID) return null;
  if (typeof from_status !== "string" || typeof to_status !== "string") return null;
  return { scope: scope as BatchScope, scope_id, from_status, to_status };
}

export type CheckedTransition =
  | { ok: true; from: BallotStatus; to: BallotStatus }
  | { ok: false; code: TransitionErrorCode; message: string };

/** C14: @vbt/domain decides; an unknown status is INVALID_STATUS. */
export function checkBatchTransition(request: BatchRequest): CheckedTransition {
  const { from_status: from, to_status: to, scope } = request;
  if (!isBallotStatus(from) || !isBallotStatus(to)) {
    return { ok: false, code: "INVALID_STATUS", message: `Unknown ballot status: ${isBallotStatus(from) ? to : from}` };
  }
  const result = validateBatchTransition({ from, to, scope });
  return result.ok ? { ok: true, from, to } : result;
}

export type StageTree = {
  root: string;
  /** Members in leaf order (ciphertext_hash, then tracking_code). */
  ordered: BatchMember[];
  leaves: Uint8Array[];
  proofs: InclusionProof[];
};

/** C17: the Merkle tree over the members' stage leaves, in leaf order. */
export function stageTree(members: readonly BatchMember[]): StageTree {
  const ordered = sortStageLeaves(members);
  const leaves = ordered.map((m) => stageLeaf(m.tracking_code, m.ciphertext_hash));
  const { root, proofs } = buildMerkleTree(leaves);
  return { root: Buffer.from(root).toString("hex"), ordered, leaves, proofs };
}

export type BuiltBatch = {
  batchId: string;
  record: StageRecord;
  signature: string;
  tree: StageTree;
  payload: Record<string, unknown>;
};

/**
 * Everything apply_batch writes, built in memory. Throws if a stored ciphertext no longer matches its
 * hash or does not open; nothing is written then.
 */
export async function buildBatch(input: {
  request: BatchRequest;
  from: BallotStatus;
  to: BallotStatus;
  members: readonly BatchMember[];
  official: Official;
  keys: ElectionKeys;
  now: Date;
  batchId: string;
}): Promise<BuiltBatch> {
  const { request, from, to, members, official, keys, now, batchId } = input;
  const ciphertexts = members.map((m) => {
    const bytes = decodeStandardBase64(m.ciphertext);
    if (!bytes || sha256Hex(bytes) !== m.ciphertext_hash) throw new Error("a stored ciphertext does not match its hash");
    return bytes;
  });
  const totals: ContestTotals = await aggregateDecrypt(ciphertexts, keys.electionSecretKey, ELECTION_MANIFEST);
  const tree = stageTree(members);
  const record: StageRecord = { scope: request.scope, stage: to, merkleRoot: tree.root, ballotCount: members.length, totals };
  const signature = Buffer.from(await signStageRecord(record, keys.signingSecretKey)).toString("base64");

  const occurredOn = indianaDate(now);
  const events = members.map((m) => ({
    ballot_id: m.ballot_id,
    prev_hash: m.head_hash,
    hash: chainEvent(
      { tracking_code: m.tracking_code, event_type: "STATUS_CHANGE", from_status: from, to_status: to, reason: null, occurred_on: occurredOn },
      m.head_hash,
    ).hash,
  }));

  return {
    batchId,
    record,
    signature,
    tree,
    payload: {
      batch_id: batchId,
      scope: request.scope,
      scope_id: request.scope_id,
      from_status: from,
      to_status: to,
      actor_role: official.role,
      actor_id: official.userId,
      occurred_at: now.toISOString(),
      events,
      stage_record: { merkle_root: tree.root, ballot_count: members.length, totals, signature },
    },
  };
}

export interface BatchDeps {
  env?: Env;
  fetch?: typeof fetch;
  now?: () => Date;
  batchId?: () => string;
  db?: ServiceDb | null;
}

/** The batch after requireRole: transition check (422), members, build, one write. */
export async function runBatch(request: BatchRequest, official: Official, deps: BatchDeps = {}): Promise<Response> {
  const checked = checkBatchTransition(request);
  if (!checked.ok) return jsonResponse(422, { error: checked.message, code: checked.code });

  const env = deps.env ?? process.env;
  const keys = loadElectionKeys(env);
  const db = deps.db !== undefined ? deps.db : serviceDb(env, deps.fetch);
  if (!keys || !db) return serverMisconfigured();

  try {
    const members = await db.batchMembers(request.scope, request.scope_id, checked.from);
    if (members.length === 0) {
      return jsonResponse(422, { error: `No ${checked.from} ballots in ${request.scope} ${request.scope_id}`, code: "NO_BALLOTS" });
    }
    if (members.some((m) => m.heads !== 1)) {
      return jsonResponse(409, { error: "conflict", message: "a ballot's chain is not a single chain" });
    }

    let built: BuiltBatch;
    try {
      built = await buildBatch({
        request,
        from: checked.from,
        to: checked.to,
        members,
        official,
        keys,
        now: (deps.now ?? (() => new Date()))(),
        batchId: (deps.batchId ?? randomUUID)(),
      });
    } catch {
      // A stored ciphertext that does not open or match its hash: a data problem, never the caller's.
      return jsonResponse(500, { error: "tally_failed" });
    }

    const result = await db.applyBatch(built.payload);
    return jsonResponse(201, {
      batch_id: result.batch_id,
      ballot_count: result.ballot_count,
      stage_record: { id: result.stage_record_id, merkle_root: built.tree.root, signature: built.signature },
    });
  } catch (error) {
    return dbFailure(error);
  }
}

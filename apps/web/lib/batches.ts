import "server-only";

import {
  type BallotStatus,
  checkCertification,
  checkMachineCounts,
  type CrossCheckId,
  isBallotStatus,
  type OfficialTarget,
  planBatch,
  sumTotals,
  type Totals,
  totalsEqual,
  TRANSITIONS,
  validateBatchTransition,
} from "@vbt/domain";
import {
  bytesToBase64,
  bytesToHex,
  ciphertextBytes,
  CryptoKeysMissingError,
  type CryptoKeys,
  CryptoUnavailableError,
  hexToBytes,
  toTotals,
} from "./crypto";
import type { CryptoPort, ElectionManifest, StageRecord } from "./crypto/port";
import { IngestError, isUploadKind, MAX_FILES, type ParsedUpload, parseUpload, type UploadKind } from "./ingest";
import type { Official } from "./require-role";
import { type BatchBallot, dbErrorStatus, DbError, type RunBatchArgs, type ServiceDb } from "./service-db";

// POST /api/batches (T-09): one action moves a whole precinct or county to its next stage.
//
// Order (all or nothing): validate the edge with @vbt/domain, check the crypto adapter is ready, parse the
// uploaded files, read the ballots in scope, run the cross-checks (C1+C2 at precinct tally, C3 on election
// night, C4 at certification), plan which ballots advance and which are challenged, build and sign the
// stage record, then one database call writes everything. Until E3 is on main the adapter is unavailable,
// so this answers 503 "stage records publish once E3 lands" before anything is written.

export interface BatchFile {
  kind: string;
  bytes: Uint8Array;
}

export interface BatchInput {
  target: OfficialTarget;
  /** The status to move to; the from status is derived from it, never taken from the client. */
  to: string;
  /** How many ballots the official confirmed; a different count on the server is a 409. */
  expectedCount: number;
  files: BatchFile[];
}

export interface BatchDeps {
  crypto: CryptoPort;
  keys: () => CryptoKeys;
  db: ServiceDb;
}

export interface Outcome {
  status: number;
  body: Record<string, unknown>;
}

class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Which uploaded files each batch edge needs: machine logs (one or more) and exactly one totals file. */
const NEEDS: Readonly<Record<string, { logs: boolean; totals: Exclude<UploadKind, "machine_log"> }>> = {
  TALLIED_PRECINCT: { logs: true, totals: "precinct_totals" },
  REPORTED_UNOFFICIAL: { logs: false, totals: "county_totals" },
  CERTIFIED: { logs: false, totals: "certified_totals" },
};

function batchEdge(to: string, scope: OfficialTarget["scope"]): { from: BallotStatus; to: BallotStatus } {
  if (!isBallotStatus(to)) throw new Refusal(400, "to_status is not a ballot status");
  const rule = TRANSITIONS.find((r) => r.to === to && r.batch !== null);
  if (!rule) throw new Refusal(400, `${to} is not reached by a batch`);
  const valid = validateBatchTransition({ from: rule.from, to, scope });
  if (!valid.ok) throw new Refusal(400, valid.message);
  return { from: rule.from, to };
}

function parseFiles(edge: { to: BallotStatus }, target: OfficialTarget, files: BatchFile[]) {
  if (files.length > MAX_FILES) throw new Refusal(400, `at most ${MAX_FILES} files per request`);
  const needs = NEEDS[edge.to]!;
  const logs: Array<Extract<ParsedUpload, { kind: "machine_log" }>> = [];
  const totals: Array<Exclude<ParsedUpload, { kind: "machine_log" }>> = [];
  for (const file of files) {
    if (!isUploadKind(file.kind) || (file.kind === "machine_log" ? !needs.logs : file.kind !== needs.totals)) {
      throw new Refusal(400, `a ${String(file.kind)} file is not used by this batch`);
    }
    try {
      const parsed = parseUpload(file.kind, target.id, file.bytes);
      if (parsed.kind === "machine_log") logs.push(parsed);
      else totals.push(parsed);
    } catch (error) {
      if (error instanceof IngestError) throw new Refusal(400, `${file.kind}: ${error.message}`);
      throw error;
    }
  }
  if (totals.length > 1) throw new Refusal(400, `upload one ${needs.totals} file`);
  if (totals.length === 0) throw new Refusal(422, `a ${needs.totals} file is required`);
  if (needs.logs && logs.length === 0) throw new Refusal(422, "the machine logs are required");
  return { logs, totals: totals[0]!.totals, uploads: [...logs, ...totals] };
}

const sortByHash = (ballots: readonly BatchBallot[]) =>
  [...ballots].sort((a, b) =>
    a.ciphertext_hash < b.ciphertext_hash ? -1 : a.ciphertext_hash > b.ciphertext_hash ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

export async function runBatch(official: Official, input: BatchInput, deps: BatchDeps): Promise<Outcome> {
  try {
    const { target } = input;
    const edge = batchEdge(input.to, target.scope);
    if (!Number.isSafeInteger(input.expectedCount) || input.expectedCount < 0) {
      throw new Refusal(400, "expected_count must be the confirmed number of ballots");
    }

    // Crypto first: without E3 nothing below may run, so nothing can be written.
    await deps.crypto.ready();

    const files = parseFiles(edge, target, input.files);
    const manifest: ElectionManifest = files.totals.manifest;
    let cachedKeys: CryptoKeys | undefined;
    const decrypt = async (ciphertexts: readonly string[]): Promise<Totals> => {
      cachedKeys ??= deps.keys();
      let contests;
      try {
        contests = await deps.crypto.aggregateDecrypt(ciphertexts.map(ciphertextBytes), cachedKeys.electionSecretKey, manifest);
      } catch (error) {
        if (error instanceof CryptoUnavailableError) throw error;
        throw new Refusal(422, "the ballots could not be tallied against the contests in the totals file");
      }
      return toTotals(contests, ciphertexts.length);
    };

    const ballots = await deps.db.batchBallots(target.scope, target.id, edge.from);
    if (ballots.length === 0) throw new Refusal(409, `no ballots are at ${edge.from} in ${target.id}`);
    if (ballots.length !== input.expectedCount) {
      return { status: 409, body: { error: "the number of ballots changed; review and confirm again", count: ballots.length } };
    }

    let failedMachines: string[] = [];
    let scopeFailed: CrossCheckId | null = null;
    let batchTotals: Totals | undefined;

    if (edge.to === "TALLIED_PRECINCT") {
      const machines = new Set(await deps.db.precinctMachines(target.id));
      const logCounts: Record<string, number> = Object.create(null);
      for (const { log } of files.logs) {
        for (const [device, count] of log.counts) {
          if (!machines.has(device)) throw new Refusal(400, `machine_log: device ${device} is not a machine in ${target.id}`);
          if (Object.hasOwn(logCounts, device)) throw new Refusal(400, `machine_log: device ${device} is in two files`);
          logCounts[device] = count;
        }
      }
      const ballotCounts = await deps.db.machineBallotCounts(target.id);
      const missing = Object.keys(ballotCounts).filter((m) => (ballotCounts[m] ?? 0) > 0 && !Object.hasOwn(logCounts, m));
      if (missing.length > 0) throw new Refusal(422, `the machine log for ${missing.sort().join(", ")} is required`);
      failedMachines = checkMachineCounts(logCounts, ballotCounts); // C1
      batchTotals = await decrypt(ballots.map((b) => b.ciphertext));
      if (!totalsEqual(batchTotals, files.totals.totals)) scopeFailed = "C2";
    } else if (edge.to === "REPORTED_UNOFFICIAL") {
      const rows = await deps.db.stageTotals("county", target.id, "TALLIED_PRECINCT");
      const precincts = sumTotals(rows.filter((r) => r.scope === "precinct").map((r) => ({ ballotCount: r.ballot_count, contests: r.totals })));
      if (!totalsEqual(precincts, files.totals.totals)) scopeFailed = "C3";
    } else {
      const rows = await deps.db.stageTotals("county", target.id, "REPORTED_UNOFFICIAL");
      const electionNight = sumTotals(rows.filter((r) => r.scope === "county").map((r) => ({ ballotCount: r.ballot_count, contests: r.totals })));
      batchTotals = await decrypt(ballots.map((b) => b.ciphertext));
      const removed = await decrypt(await deps.db.challengeRemoved(target.id));
      if (!checkCertification({ electionNight, certified: files.totals.totals, current: batchTotals, removed })) scopeFailed = "C4";
    }

    const plan = planBatch({ ballots: ballots.map((b) => ({ id: b.id, machineId: b.machine_id })), failedMachines, scopeFailed });

    let stageRecord: RunBatchArgs["stageRecord"] = null;
    if (plan.advance.length > 0) {
      const advancing = new Set(plan.advance);
      const leaves = sortByHash(ballots.filter((b) => advancing.has(b.id)));
      const merkleRoot = bytesToHex(deps.crypto.buildMerkleTree(leaves.map((b) => hexToBytes(b.ciphertext_hash))).root);
      const totals =
        batchTotals && leaves.length === ballots.length ? batchTotals : await decrypt(leaves.map((b) => b.ciphertext));
      const record: StageRecord = {
        scope: `${target.scope}:${target.id}`,
        stage: edge.to,
        merkleRoot,
        ballotCount: leaves.length,
        totals: totals.contests as StageRecord["totals"],
      };
      cachedKeys ??= deps.keys();
      const signature = await deps.crypto.signStageRecord(record, cachedKeys.signingSecretKey);
      if (!(await deps.crypto.verifyStageRecord(record, signature, cachedKeys.signingPublicKey))) {
        throw new Error("the stage record signature does not verify with the configured public key");
      }
      stageRecord = { merkle_root: merkleRoot, ballot_count: leaves.length, totals: record.totals, signature: bytesToBase64(signature) };
    }

    const result = await deps.db.runBatch({
      scope: target.scope,
      scopeId: target.id,
      from: edge.from,
      to: edge.to,
      actorRole: official.role,
      actorId: official.userId,
      advance: plan.advance,
      challenge: plan.challenge,
      stageRecord,
      uploads: files.uploads.map((u) => ({ file_sha256: u.sha256, kind: u.kind, scope_id: target.id })),
    });
    return {
      status: 201,
      body: {
        batch_id: result.batch_id,
        count: result.count,
        challenged: result.challenged,
        stage_record_id: result.stage_record_id,
      },
    };
  } catch (error) {
    return failure(error);
  }
}

/** Maps a refusal or failure to a response body that never echoes ballot data. */
export function failure(error: unknown): Outcome {
  if (error instanceof Refusal) return { status: error.status, body: { error: error.message } };
  if (error instanceof CryptoUnavailableError) return { status: 503, body: { error: error.message } };
  if (error instanceof CryptoKeysMissingError) return { status: 503, body: { error: error.message } };
  if (error instanceof DbError) {
    const status = dbErrorStatus(error);
    if (status === 409) return { status, body: { error: "the ballots in scope changed; review and confirm again" } };
    if (status !== 500) return { status, body: { error: error.message } };
  }
  return { status: 500, body: { error: "the batch failed; nothing was changed" } };
}

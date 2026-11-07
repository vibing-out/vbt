// Turns a plan into the rows the writer inserts. Every cryptographic value (keys, ciphertexts, tracking
// codes, hashes, Merkle roots, totals, signatures) comes from the CryptoAdapter; nothing here hashes or
// signs. With pendingCrypto this throws before a single row exists.

import { randomUUID } from "node:crypto";
import { mismatchEventPlan, validateBatchTransition } from "@vbt/domain";
import type { CryptoAdapter, StageRecord } from "./crypto-adapter.ts";
import { BALLOT_STYLE, CAST_DATE, MANIFEST, MODEL, type Plan, VENDOR } from "./plan.ts";

/** Fixed times on election day in Indiana time (EST on Nov 3, 2026). Only the date is ever public. */
export const CAST_AT = `${CAST_DATE}T12:00:00-05:00`;
export const TALLY_AT = `${CAST_DATE}T21:00:00-05:00`;
export const ACTOR_ROLE = "simulator";
export const ACTOR_ID = "scale-demo";
export const STAGE = "TALLIED_PRECINCT";

export interface SeedKeys {
  electionPublicKey: Uint8Array;
  electionSecretKey: Uint8Array;
  stageSigningPublicKey: Uint8Array;
  stageSigningSecretKey: Uint8Array;
}

const KEY_VARS = {
  electionPublicKey: "ELECTION_PUBLIC_KEY",
  electionSecretKey: "ELECTION_SECRET_KEY",
  stageSigningPublicKey: "STAGE_SIGNING_PUBLIC_KEY",
  stageSigningSecretKey: "STAGE_SIGNING_SECRET_KEY",
} as const;

/** Reads the four base64 keys (.env.example). Errors name the variable, never its value. */
export function readKeys(env: Readonly<Record<string, string | undefined>>): SeedKeys {
  const out: Partial<SeedKeys> = {};
  for (const [field, name] of Object.entries(KEY_VARS) as Array<[keyof SeedKeys, string]>) {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is not set (base64; see .env.example)`);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(`${name} is not base64`);
    out[field] = new Uint8Array(Buffer.from(value, "base64"));
  }
  return out as SeedKeys;
}

export interface PrecinctRow { id: string; county_id: string; name: string }
export interface MachineRow { id: string; precinct_id: string; vendor: string; model: string; public_key: string }
export interface BallotRow {
  id: string;
  tracking_code: string;
  prev_tracking_code: string | null;
  ciphertext: string;
  ciphertext_hash: string;
  ballot_style: string;
  precinct_id: string;
  machine_id: string;
  cast_date: string;
}
export interface StatusRow { id: string; current_status: "TALLIED_PRECINCT" | "CHALLENGED"; mismatch: boolean }
export interface BatchRow {
  id: string;
  scope: "precinct";
  scope_id: string;
  from_status: "CAST";
  to_status: "TALLIED_PRECINCT";
  actor_id: string;
  ballot_count: number;
}
export interface EventRow {
  ballot_id: string;
  precinct_id: string;
  county_id: string;
  event_type: "CAST" | "STATUS_CHANGE" | "MISMATCH_DETECTED";
  from_status: string | null;
  to_status: string | null;
  actor_role: string;
  actor_id: string;
  batch_id: string | null;
  reason: string | null;
  occurred_at: string;
  prev_hash: string | null;
  hash: string;
}
export interface StageRecordRow {
  scope: "precinct";
  scope_id: string;
  stage: string;
  merkle_root: string;
  ballot_count: number;
  totals: Record<string, Record<string, number>>;
  signature: string;
}
export interface PrecinctSummary { precinct_id: string; ballots: number; tallied: number; challenged: number }

export interface SeedRows {
  countyId: string;
  precincts: PrecinctRow[];
  machines: MachineRow[];
  /** Inserted as CAST / not mismatched, then moved to their final status by `statuses`. */
  ballots: BallotRow[];
  statuses: StatusRow[];
  batches: BatchRow[];
  events: EventRow[];
  stageRecords: StageRecordRow[];
  summary: PrecinctSummary[];
}

const HEX_32 = /^[0-9a-f]{64}$/;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

function checkHash(value: string, what: string): string {
  if (!HEX_32.test(value)) throw new Error(`${what} must be 64 lowercase hex characters`);
  return value;
}

type Step = { eventType: EventRow["event_type"]; from: string | null; to: string | null; reason: string | null; actorId: string; batchId: string | null; occurredAt: string };

/** One ballot's events, each chaining the previous one's hash (hash input: public fields, date only). */
function chainEvents(crypto: CryptoAdapter, ballot: BallotRow, countyId: string, steps: readonly Step[]): EventRow[] {
  let prevHash: string | null = null;
  return steps.map((step) => {
    const hash = checkHash(
      crypto.eventHash({
        prevHash,
        ballotId: ballot.id,
        precinctId: ballot.precinct_id,
        countyId,
        eventType: step.eventType,
        fromStatus: step.from,
        toStatus: step.to,
        reason: step.reason,
        occurredOn: CAST_DATE,
      }),
      "event hash",
    );
    const row: EventRow = {
      ballot_id: ballot.id,
      precinct_id: ballot.precinct_id,
      county_id: countyId,
      event_type: step.eventType,
      from_status: step.from,
      to_status: step.to,
      actor_role: ACTOR_ROLE,
      actor_id: step.actorId,
      batch_id: step.batchId,
      reason: step.reason,
      occurred_at: step.occurredAt,
      prev_hash: prevHash,
      hash,
    };
    prevHash = hash;
    return row;
  });
}

export async function buildRows(plan: Plan, crypto: CryptoAdapter, keys: SeedKeys): Promise<SeedRows> {
  const batchCheck = validateBatchTransition({ from: "CAST", to: "TALLIED_PRECINCT", scope: "precinct" });
  if (!batchCheck.ok) throw new Error(batchCheck.message);

  const precincts: PrecinctRow[] = plan.precincts.map((p) => ({ id: p.id, county_id: p.countyId, name: p.name }));
  const machines: MachineRow[] = [];
  for (const p of plan.precincts) {
    const { publicKey } = await crypto.generateSigningKeyPair();
    machines.push({ id: p.machineId, precinct_id: p.id, vendor: VENDOR, model: MODEL, public_key: b64(publicKey) });
  }

  // Ciphertexts and tracking codes, chained per machine in casting order.
  const prevByMachine = new Map<string, string>();
  const seenCodes = new Set<string>();
  const built: Array<{ row: BallotRow; ciphertext: Uint8Array; mismatch: boolean }> = [];
  for (const planned of plan.ballots) {
    const ciphertext = await crypto.encryptBallot(planned.plaintext, keys.electionPublicKey);
    const prev = prevByMachine.get(planned.machineId) ?? null;
    const code = crypto.computeTrackingCode(ciphertext, prev);
    if (!crypto.isTrackingCode(code)) throw new Error("computeTrackingCode returned a malformed tracking code");
    if (seenCodes.has(code)) throw new Error("computeTrackingCode returned a duplicate tracking code");
    seenCodes.add(code);
    prevByMachine.set(planned.machineId, code);
    built.push({
      ciphertext,
      mismatch: planned.mismatch,
      row: {
        id: randomUUID(),
        tracking_code: code,
        prev_tracking_code: prev,
        ciphertext: b64(ciphertext),
        ciphertext_hash: checkHash(crypto.ciphertextHash(ciphertext), "ciphertext hash"),
        ballot_style: BALLOT_STYLE,
        precinct_id: planned.precinctId,
        machine_id: planned.machineId,
        cast_date: CAST_DATE,
      },
    });
  }

  const statuses: StatusRow[] = [];
  const batches: BatchRow[] = [];
  const events: EventRow[] = [];
  const stageRecords: StageRecordRow[] = [];
  const summary: PrecinctSummary[] = [];
  const cast = (actorId: string): Step => ({ eventType: "CAST", from: null, to: null, reason: null, actorId, batchId: null, occurredAt: CAST_AT });
  const challenge = mismatchEventPlan("CAST").map(
    (s): Step => ({ eventType: s.eventType, from: s.from, to: s.to, reason: s.reason, actorId: ACTOR_ID, batchId: null, occurredAt: TALLY_AT }),
  );

  for (const precinct of plan.precincts) {
    const inPrecinct = built.filter((b) => b.row.precinct_id === precinct.id);
    // Mismatched ballots stay out of the batch and the stage record (locked § Cross-checks).
    const tallied = inPrecinct.filter((b) => !b.mismatch);
    const batchId = randomUUID();
    batches.push({
      id: batchId,
      scope: "precinct",
      scope_id: precinct.id,
      from_status: "CAST",
      to_status: "TALLIED_PRECINCT",
      actor_id: ACTOR_ID,
      ballot_count: tallied.length,
    });

    for (const b of inPrecinct) {
      const steps: Step[] = b.mismatch
        ? [cast(precinct.machineId), ...challenge]
        : [cast(precinct.machineId), { eventType: "STATUS_CHANGE", from: "CAST", to: "TALLIED_PRECINCT", reason: null, actorId: ACTOR_ID, batchId, occurredAt: TALLY_AT }];
      events.push(...chainEvents(crypto, b.row, precinct.countyId, steps));
      statuses.push({ id: b.row.id, current_status: b.mismatch ? "CHALLENGED" : "TALLIED_PRECINCT", mismatch: b.mismatch });
    }

    // Leaves: the 32-byte ciphertext hashes, sorted by hex, so anyone can rebuild the root from the
    // published (hash-ordered) record.
    const leaves = tallied
      .map((b) => b.row.ciphertext_hash)
      .sort()
      .map((h) => new Uint8Array(Buffer.from(h, "hex")));
    const { root } = crypto.buildMerkleTree(leaves);
    const totals = await crypto.aggregateDecrypt(
      tallied.map((b) => b.ciphertext),
      keys.electionSecretKey,
      MANIFEST,
    );
    const record: StageRecord = { scope: "precinct", stage: STAGE, merkleRoot: checkHash(hex(root), "Merkle root"), ballotCount: tallied.length, totals };
    const signature = await crypto.signStageRecord(record, keys.stageSigningSecretKey);
    if (!(await crypto.verifyStageRecord(record, signature, keys.stageSigningPublicKey))) {
      throw new Error(`stage record for ${precinct.id} does not verify with STAGE_SIGNING_PUBLIC_KEY`);
    }
    stageRecords.push({
      scope: "precinct",
      scope_id: precinct.id,
      stage: STAGE,
      merkle_root: record.merkleRoot,
      ballot_count: record.ballotCount,
      totals,
      signature: b64(signature),
    });
    summary.push({ precinct_id: precinct.id, ballots: inPrecinct.length, tallied: tallied.length, challenged: inPrecinct.length - tallied.length });
  }

  // Insert ballots and events in hash order, not casting order, so the physical row order of the
  // private tables carries no sequence either.
  const ballots = built.map((b) => b.row).sort((a, b) => byText(a.ciphertext_hash, b.ciphertext_hash));
  events.sort((a, b) => byText(a.hash, b.hash));
  return { countyId: plan.countyId, precincts, machines, ballots, statuses, batches, events, stageRecords, summary };
}

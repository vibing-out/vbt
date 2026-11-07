// Test-only: throwaway election keys (generated per run, never real ones), sealed demo ballots and
// ballot-record files, plus an in-memory ServiceDb. Never imported by app code.
import {
  computeTrackingCode,
  encryptBallot,
  generateElectionKeyPair,
  generateSigningKeyPair,
  type BallotPlaintext,
} from "@vbt/crypto";
import { RECORD_FILE_FORMAT, RECORD_FILE_VERSION, sha256Hex, type RecordFileBallot } from "@vbt/events";
import { ELECTION_ID, type ElectionKeys } from "../election";
import type { Official } from "../require-role";
import type { BatchMember, ServiceDb, StoredBallot } from "../service-db";
import { MACHINES, PRECINCTS } from "./fake-supabase";

const election = await generateElectionKeyPair();
const signing = await generateSigningKeyPair();
const otherElection = await generateElectionKeyPair();

export const KEYS: ElectionKeys = {
  electionPublicKey: election.publicKey,
  electionSecretKey: election.secretKey,
  signingSecretKey: signing.secretKey,
};
export const SIGNING_PUBLIC_KEY = signing.publicKey;
export const OTHER_ELECTION_PUBLIC_KEY = otherElection.publicKey;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** The key env vars, as Vercel holds them (standard base64). */
export const KEY_ENV = {
  ELECTION_PUBLIC_KEY: b64(election.publicKey),
  ELECTION_SECRET_KEY: b64(election.secretKey),
  STAGE_SIGNING_PUBLIC_KEY: b64(signing.publicKey),
  STAGE_SIGNING_SECRET_KEY: b64(signing.secretKey),
};

export const COUNTY_OFFICIAL: Official = { role: "county", scope: "county", scopeId: "18097", userId: "00000000-0000-4000-8000-000000000002" };
export const POLL_WORKER: Official = { role: "poll_worker", scope: "precinct", scopeId: "18097-001", userId: "00000000-0000-4000-8000-000000000001" };

const CHOICES = [
  { president: "cand-a", measure: "yes" },
  { president: "cand-b", measure: "no" },
  { president: "cand-c", measure: "yes" },
  { president: "cand-a", measure: "no" },
];

export function plaintext(i: number): BallotPlaintext {
  const choice = CHOICES[i % CHOICES.length]!;
  return {
    contests: [
      { contestId: "contest-president", choiceIds: [choice.president] },
      { contestId: "contest-measure-1", choiceIds: [choice.measure] },
    ],
  };
}

/** n sealed ballots from one machine, tracking codes chained in order. */
export async function sealedBallots(
  n: number,
  options: { precinct?: string; machine?: string; publicKey?: Uint8Array; offset?: number } = {},
): Promise<RecordFileBallot[]> {
  const precinct = options.precinct ?? "18097-001";
  const machine = options.machine ?? MACHINES.find((m) => m.precinct_id === precinct)!.id;
  const ballots: RecordFileBallot[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    const ciphertext = await encryptBallot(plaintext(i + (options.offset ?? 0)), options.publicKey ?? election.publicKey);
    const code = computeTrackingCode(ciphertext, prev);
    ballots.push({
      tracking_code: code,
      prev_tracking_code: prev,
      ciphertext: b64(ciphertext),
      ballot_style: "style-general",
      precinct_id: precinct,
      machine_id: machine,
      cast_date: "2026-11-03",
    });
    prev = code;
  }
  return ballots;
}

export function recordFile(ballots: RecordFileBallot[], overrides: Record<string, unknown> = {}) {
  return { format: RECORD_FILE_FORMAT, version: RECORD_FILE_VERSION, election_id: ELECTION_ID, county_id: "18097", ballots, ...overrides };
}

export const fileBytes = (file: unknown) => new TextEncoder().encode(JSON.stringify(file));

/** Batch members as batch_members returns them, for sealed ballots already ingested. */
export function membersOf(ballots: readonly RecordFileBallot[], headHash: (code: string) => string | null = () => "0".repeat(64)): BatchMember[] {
  return ballots.map((b, i) => ({
    ballot_id: `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`,
    tracking_code: b.tracking_code,
    ciphertext: b.ciphertext,
    ciphertext_hash: sha256Hex(Buffer.from(b.ciphertext, "base64")),
    precinct_id: b.precinct_id,
    county_id: PRECINCTS.find((p) => p.id === b.precinct_id)!.county_id,
    head_hash: headHash(b.tracking_code),
    heads: 1,
  }));
}

export type MemoryDb = ServiceDb & { calls: Array<{ method: string; args: unknown[] }> };

/** An in-memory ServiceDb: fixed answers, every call recorded. */
export function memoryDb(state: {
  stored?: StoredBallot[];
  members?: BatchMember[];
  ingest?: () => Promise<{ file_id: string; event_ids: string[] }>;
  apply?: () => Promise<{ batch_id: string; stage_record_id: string; ballot_count: number }>;
} = {}): MemoryDb {
  const calls: MemoryDb["calls"] = [];
  const record = (method: string, args: unknown[]) => calls.push({ method, args });
  return {
    calls,
    async precincts(ids) {
      record("precincts", [ids]);
      return PRECINCTS.filter((p) => ids.includes(p.id));
    },
    async machines(ids) {
      record("machines", [ids]);
      return MACHINES.filter((m) => ids.includes(m.id));
    },
    async chainHeads(codes) {
      record("chainHeads", [codes]);
      return (state.stored ?? []).filter((s) => codes.includes(s.tracking_code));
    },
    async ingestBallotRecord(file) {
      record("ingestBallotRecord", [file]);
      return state.ingest ? state.ingest() : { file_id: "file-1", event_ids: ["event-1"] };
    },
    async batchMembers(scope, scopeId, from) {
      record("batchMembers", [scope, scopeId, from]);
      return state.members ?? [];
    },
    async applyBatch(batch) {
      record("applyBatch", [batch]);
      const b = batch as { batch_id: string; events: unknown[] };
      return state.apply ? state.apply() : { batch_id: b.batch_id, stage_record_id: b.batch_id, ballot_count: b.events.length };
    },
  };
}

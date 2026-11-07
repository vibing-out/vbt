import {
  buildMerkleTree,
  generateElectionKeyPair,
  generateSigningKeyPair,
  isTrackingCode,
  type StageRecord,
  verifyInclusionProof,
  verifyStageRecord,
} from "@vbt/crypto";
import { type ChainedEvent, sha256Hex, sortStageLeaves, stageLeaf, verifyChain } from "@vbt/events";
import { beforeAll, expect, test } from "vitest";
import { buildRows, type SeedKeys, type SeedRows, STAGE } from "./build.ts";
import { DEFAULT_CRYPTO, realCrypto } from "./crypto-adapter.ts";
import { buildPlan } from "./plan.ts";

// The real adapter end to end: a small seed built with @vbt/crypto and @vbt/events must verify the way
// the tracker and verifier check uploaded ballots (event chain, stage leaves, signature).
const plan = buildPlan({ ballots: 40, precincts: 2, rate: 0.05, seed: "real-crypto-test" });
let rows: SeedRows;
let keys: SeedKeys;

beforeAll(async () => {
  const election = await generateElectionKeyPair();
  const signing = await generateSigningKeyPair();
  keys = {
    electionPublicKey: election.publicKey,
    electionSecretKey: election.secretKey,
    stageSigningPublicKey: signing.publicKey,
    stageSigningSecretKey: signing.secretKey,
  };
  rows = await buildRows(plan, realCrypto, keys);
});

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const isMismatch = (ballotId: string) => rows.statuses.find((s) => s.id === ballotId)!.mismatch;
const recordOf = (precinctId: string): StageRecord => {
  const r = rows.stageRecords.find((s) => s.scope_id === precinctId)!;
  return { scope: r.scope, stage: r.stage, merkleRoot: r.merkle_root, ballotCount: r.ballot_count, totals: r.totals };
};

test("the CLI's default adapter is realCrypto, and it cannot be patched", () => {
  expect(DEFAULT_CRYPTO).toBe(realCrypto);
  expect(Object.isFrozen(realCrypto)).toBe(true);
});

test("tracking codes are real codes and ciphertext hashes are @vbt/events' sha256Hex", () => {
  expect(rows.ballots).toHaveLength(40);
  for (const b of rows.ballots) {
    expect(isTrackingCode(b.tracking_code)).toBe(true);
    expect(b.ciphertext_hash).toBe(sha256Hex(Buffer.from(b.ciphertext, "base64")));
  }
});

test("every ballot's events verify as a @vbt/events chain", () => {
  for (const ballot of rows.ballots) {
    const mine = rows.events.filter((e) => e.ballot_id === ballot.id);
    const chain: ChainedEvent[] = [];
    for (let prev: string | null = null; chain.length < mine.length; ) {
      const e = mine.find((x) => x.prev_hash === prev)!;
      chain.push({
        tracking_code: ballot.tracking_code,
        event_type: e.event_type,
        from_status: e.from_status,
        to_status: e.to_status,
        reason: e.reason,
        occurred_on: "2026-11-03",
        prev_hash: e.prev_hash,
        hash: e.hash,
      });
      prev = e.hash;
    }
    expect(verifyChain(chain)).toEqual({ ok: true });
  }
});

test("each stage record is signed, and every tallied ballot has an inclusion proof under its root", async () => {
  for (const precinct of plan.precincts) {
    const record = recordOf(precinct.id);
    const signature = Buffer.from(rows.stageRecords.find((s) => s.scope_id === precinct.id)!.signature, "base64");
    expect(record.stage).toBe(STAGE);
    expect(await verifyStageRecord(record, signature, keys.stageSigningPublicKey)).toBe(true);

    const tallied = sortStageLeaves(rows.ballots.filter((b) => b.precinct_id === precinct.id && !isMismatch(b.id)));
    expect(record.ballotCount).toBe(tallied.length);
    const { root, proofs } = buildMerkleTree(tallied.map((b) => stageLeaf(b.tracking_code, b.ciphertext_hash)));
    expect(hex(root)).toBe(record.merkleRoot);
    tallied.forEach((b, i) => {
      expect(verifyInclusionProof(stageLeaf(b.tracking_code, b.ciphertext_hash), proofs[i]!, root)).toBe(true);
    });
  }
});

test("altering one total or one ciphertext breaks verification", async () => {
  const precinct = plan.precincts[0]!;
  const record = recordOf(precinct.id);
  const signature = Buffer.from(rows.stageRecords.find((s) => s.scope_id === precinct.id)!.signature, "base64");
  const [contest, choices] = Object.entries(record.totals)[0]!;
  const [choice, count] = Object.entries(choices)[0]!;
  const altered = { ...record, totals: { ...record.totals, [contest]: { ...choices, [choice]: count + 1 } } };
  expect(await verifyStageRecord(altered, signature, keys.stageSigningPublicKey)).toBe(false);

  const tallied = sortStageLeaves(rows.ballots.filter((b) => b.precinct_id === precinct.id && !isMismatch(b.id)));
  const { root, proofs } = buildMerkleTree(tallied.map((b) => stageLeaf(b.tracking_code, b.ciphertext_hash)));
  const bytes = Buffer.from(tallied[0]!.ciphertext, "base64");
  bytes[0] = bytes[0]! ^ 0xff;
  expect(verifyInclusionProof(stageLeaf(tallied[0]!.tracking_code, sha256Hex(bytes)), proofs[0]!, root)).toBe(false);
});

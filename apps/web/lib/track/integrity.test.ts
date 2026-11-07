import { buildMerkleTree, generateSigningKeyPair, signStageRecord } from "@vbt/crypto";
import { sha256Hex, sortStageLeaves, stageLeaf } from "@vbt/events";
import { expect, test, vi } from "vitest";
import type { PublishedRecord, StageRecordSource } from "../../app/api/record/record";
import { KEYS, SIGNING_PUBLIC_KEY } from "../testing/election-fixtures";
import { recordIntegrityChecker, type StageRecordRef } from "./integrity";

vi.mock("server-only", () => ({}));

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const BALLOTS = ["ALPHA-ONE-0001-AAA", "BRAVO-TWO-0002-BBB", "CHARLIE-THREE-0003-CCC"].map((code) => ({
  tracking_code: code,
  ciphertext_hash: sha256Hex(new TextEncoder().encode(code)),
}));

async function publishedRecord(): Promise<PublishedRecord> {
  const ballots = sortStageLeaves(BALLOTS);
  const root = hex(buildMerkleTree(ballots.map((b) => stageLeaf(b.tracking_code, b.ciphertext_hash))).root);
  const totals = { mayor: { a: 2, b: 1 } };
  const signature = await signStageRecord(
    { scope: "precinct", stage: "TALLIED_PRECINCT", merkleRoot: root, ballotCount: ballots.length, totals },
    KEYS.signingSecretKey,
  );
  return {
    scope: "precinct",
    scope_id: "18097-001",
    stage: "TALLIED_PRECINCT",
    merkle_root: root,
    ballot_count: ballots.length,
    totals,
    published_on: "2026-11-03",
    signature: hex(signature),
    ballots,
  };
}

const sourceOf = (record: PublishedRecord | null): StageRecordSource & { reads: number } => {
  const source = { reads: 0, read: async () => (source.reads++, record) };
  return source;
};

const refFor = (record: PublishedRecord): StageRecordRef => ({
  stage: "TALLIED_PRECINCT",
  scope: "precinct",
  scopeId: record.scope_id,
  merkleRoot: record.merkle_root,
  signature: record.signature,
  publishedOn: record.published_on,
});

test("a ballot in a published, correctly signed record passes, and the record is read once", async () => {
  const record = await publishedRecord();
  const source = sourceOf(record);
  const checker = recordIntegrityChecker(source, SIGNING_PUBLIC_KEY);
  for (const b of BALLOTS) {
    const result = await checker.check({ trackingCode: b.tracking_code, ciphertextHash: b.ciphertext_hash, record: refFor(record) });
    expect(result.state, b.tracking_code).toBe("passed");
  }
  expect(source.reads).toBe(1);
});

test("a tampered ciphertext hash fails", async () => {
  const record = await publishedRecord();
  const checker = recordIntegrityChecker(sourceOf(record), SIGNING_PUBLIC_KEY);
  const b = BALLOTS[0]!;
  const tampered = sha256Hex(new TextEncoder().encode("tampered"));
  const result = await checker.check({ trackingCode: b.tracking_code, ciphertextHash: tampered, record: refFor(record) });
  expect(result.state).toBe("failed");
});

test("a record altered after signing, or checked with another key, fails", async () => {
  const record = await publishedRecord();
  const b = BALLOTS[1]!;
  const input = { trackingCode: b.tracking_code, ciphertextHash: b.ciphertext_hash };
  const altered = { ...record, totals: { mayor: { a: 3, b: 0 } } };
  expect((await recordIntegrityChecker(sourceOf(altered), SIGNING_PUBLIC_KEY).check({ ...input, record: refFor(altered) })).state).toBe("failed");
  const other = await generateSigningKeyPair();
  expect((await recordIntegrityChecker(sourceOf(record), other.publicKey).check({ ...input, record: refFor(record) })).state).toBe("failed");
});

test("no published record, no key or no source is unavailable, never passed", async () => {
  const record = await publishedRecord();
  const b = BALLOTS[2]!;
  const input = { trackingCode: b.tracking_code, ciphertextHash: b.ciphertext_hash, record: refFor(record) };
  expect((await recordIntegrityChecker(sourceOf(null), SIGNING_PUBLIC_KEY).check(input)).state).toBe("unavailable");
  expect((await recordIntegrityChecker(sourceOf(record), null).check(input)).state).toBe("unavailable");
  expect((await recordIntegrityChecker(null, SIGNING_PUBLIC_KEY).check(input)).state).toBe("unavailable");
});

test("the signing public key comes from STAGE_SIGNING_PUBLIC_KEY, or else the secret key's public half", async () => {
  const { loadStageSigningPublicKey } = await import("../election");
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  expect(loadStageSigningPublicKey({ STAGE_SIGNING_PUBLIC_KEY: b64(SIGNING_PUBLIC_KEY) })).toEqual(SIGNING_PUBLIC_KEY);
  expect(loadStageSigningPublicKey({ STAGE_SIGNING_SECRET_KEY: b64(KEYS.signingSecretKey) })).toEqual(SIGNING_PUBLIC_KEY);
  expect(loadStageSigningPublicKey({})).toBeNull();
});

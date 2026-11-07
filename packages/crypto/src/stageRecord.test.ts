// AC4: Ed25519 stage-record sign/verify; field tamper fails.
import { beforeAll, describe, expect, it } from "vitest";
import { generateSigningKeyPair, signStageRecord, verifyStageRecord, type StageRecord } from "./index.js";
import { stageRecordBytes } from "./stageRecord.js";
import { canonicalJson } from "./internal/canonicalJson.js";
import { flipByte } from "./fixtures.test-helpers.js";

const record: StageRecord = {
  scope: "precinct-12",
  stage: "TALLIED_PRECINCT",
  merkleRoot: "ab".repeat(32),
  ballotCount: 3,
  totals: { mayor: { alvarez: 2, chen: 1 }, "measure-a": { yes: 3, no: 0 } },
};

let keys: { publicKey: Uint8Array; secretKey: Uint8Array };
let signature: Uint8Array;

beforeAll(async () => {
  keys = await generateSigningKeyPair();
  signature = await signStageRecord(record, keys.secretKey);
});

describe("stage records (AC4)", () => {
  it("signs with Ed25519 and verifies", async () => {
    expect(keys.publicKey).toHaveLength(32);
    expect(keys.secretKey).toHaveLength(64);
    expect(signature).toHaveLength(64);
    expect(await verifyStageRecord(record, signature, keys.publicKey)).toBe(true);
  });

  it("is independent of key order in the input", async () => {
    const reordered: StageRecord = {
      totals: { "measure-a": { no: 0, yes: 3 }, mayor: { chen: 1, alvarez: 2 } },
      ballotCount: 3,
      merkleRoot: record.merkleRoot,
      stage: record.stage,
      scope: record.scope,
    };
    expect(await verifyStageRecord(reordered, signature, keys.publicKey)).toBe(true);
  });

  const tampers: Array<[string, StageRecord]> = [
    ["scope", { ...record, scope: "precinct-13" }],
    ["stage", { ...record, stage: "CERTIFIED" }],
    ["merkleRoot", { ...record, merkleRoot: "ab".repeat(31) + "ac" }],
    ["ballotCount", { ...record, ballotCount: 4 }],
    ["totals count", { ...record, totals: { ...record.totals, mayor: { alvarez: 1, chen: 2 } } }],
    ["totals choice added", { ...record, totals: { ...record.totals, mayor: { alvarez: 2, chen: 1, brooks: 0 } } }],
    ["totals contest removed", { ...record, totals: { mayor: { alvarez: 2, chen: 1 } } }],
  ];
  it.each(tampers)("tampering with %s fails verification", async (_field, tampered) => {
    expect(await verifyStageRecord(tampered, signature, keys.publicKey)).toBe(false);
  });

  it("a tampered signature or wrong key fails", async () => {
    expect(await verifyStageRecord(record, flipByte(signature, 0), keys.publicKey)).toBe(false);
    const other = await generateSigningKeyPair();
    expect(await verifyStageRecord(record, signature, other.publicKey)).toBe(false);
  });

  it("returns false rather than throwing on malformed input", async () => {
    expect(await verifyStageRecord(record, new Uint8Array(10), keys.publicKey)).toBe(false);
    expect(await verifyStageRecord(record, signature, new Uint8Array(10))).toBe(false);
    expect(await verifyStageRecord({ ...record, ballotCount: -1 }, signature, keys.publicKey)).toBe(false);
    expect(await verifyStageRecord(null as never, signature, keys.publicKey)).toBe(false);
  });

  it("signs exactly the canonical JSON of the five fields", () => {
    const withExtra = { ...record, publishedAt: "2026-11-07" } as StageRecord;
    const expected =
      '{"ballotCount":3,"merkleRoot":"' +
      "ab".repeat(32) +
      '","scope":"precinct-12","stage":"TALLIED_PRECINCT",' +
      '"totals":{"mayor":{"alvarez":2,"chen":1},"measure-a":{"no":0,"yes":3}}}';
    expect(new TextDecoder().decode(stageRecordBytes(withExtra))).toBe(expected);
  });

  it("refuses to sign a malformed record", async () => {
    await expect(signStageRecord({ ...record, merkleRoot: "AB".repeat(32) }, keys.secretKey)).rejects.toThrow(
      /lowercase hex/,
    );
    await expect(signStageRecord({ ...record, ballotCount: 1.5 }, keys.secretKey)).rejects.toThrow(/ballotCount/);
    await expect(
      signStageRecord({ ...record, totals: { mayor: { alvarez: Number.NaN } } }, keys.secretKey),
    ).rejects.toThrow(/totals/);
    await expect(signStageRecord(record, new Uint8Array(32))).rejects.toThrow(/signingSecretKey/);
  });
});

describe("canonicalJson", () => {
  it("sorts keys recursively, keeps array order, and adds no whitespace", () => {
    expect(canonicalJson({ b: 1, a: [{ z: 1, y: 2 }, 3] })).toBe('{"a":[{"y":2,"z":1},3],"b":1}');
  });

  it("rejects values that are not JSON", () => {
    expect(() => canonicalJson({ a: undefined })).toThrow(TypeError);
    expect(() => canonicalJson({ a: Infinity })).toThrow(TypeError);
    expect(() => canonicalJson(new Date())).toThrow(TypeError);
  });
});

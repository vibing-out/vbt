import { utf8 } from "./internal/bytes.js";
import { canonicalJson } from "./internal/canonicalJson.js";
import type { ContestTotals } from "./manifest.js";
import { getSodium } from "./ready.js";

/** The signed part of a published per-stage record (stage_records row). */
export type StageRecord = {
  scope: string;
  stage: string;
  /** Lowercase hex of the 32-byte Merkle root. */
  merkleRoot: string;
  ballotCount: number;
  totals: ContestTotals;
};

const HEX_32 = /^[0-9a-f]{64}$/;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Internal: the exact bytes that are signed. Canonical JSON (sorted keys, no
 * whitespace) of exactly scope, stage, merkleRoot, ballotCount and totals.
 * Other properties on the input are ignored and not covered by the signature.
 */
export function stageRecordBytes(record: StageRecord): Uint8Array {
  if (!isPlainRecord(record)) throw new TypeError("record must be an object");
  const { scope, stage, merkleRoot, ballotCount, totals } = record;
  if (typeof scope !== "string" || scope.length === 0) throw new TypeError("scope must be a non-empty string");
  if (typeof stage !== "string" || stage.length === 0) throw new TypeError("stage must be a non-empty string");
  if (typeof merkleRoot !== "string" || !HEX_32.test(merkleRoot)) {
    throw new TypeError("merkleRoot must be 64 lowercase hex characters");
  }
  if (!isCount(ballotCount)) throw new TypeError("ballotCount must be a non-negative integer");
  if (!isPlainRecord(totals)) throw new TypeError("totals must be an object");
  for (const [contestId, row] of Object.entries(totals)) {
    if (!isPlainRecord(row)) throw new TypeError(`totals.${contestId} must be an object`);
    for (const [choiceId, count] of Object.entries(row)) {
      if (!isCount(count)) throw new TypeError(`totals.${contestId}.${choiceId} must be a non-negative integer`);
    }
  }
  return utf8(canonicalJson({ scope, stage, merkleRoot, ballotCount, totals }));
}

/** Ed25519 detached signature over the canonical stage-record bytes. */
export async function signStageRecord(record: StageRecord, signingSecretKey: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  if (!(signingSecretKey instanceof Uint8Array) || signingSecretKey.length !== sodium.crypto_sign_SECRETKEYBYTES) {
    throw new TypeError(`signingSecretKey must be a ${sodium.crypto_sign_SECRETKEYBYTES}-byte Uint8Array`);
  }
  return sodium.crypto_sign_detached(stageRecordBytes(record), signingSecretKey);
}

/** True only if the signature is valid for exactly this record. Returns false (never throws) on malformed input. */
export async function verifyStageRecord(
  record: StageRecord,
  signature: Uint8Array,
  signingPublicKey: Uint8Array,
): Promise<boolean> {
  const sodium = await getSodium();
  if (!(signature instanceof Uint8Array) || signature.length !== sodium.crypto_sign_BYTES) return false;
  if (!(signingPublicKey instanceof Uint8Array) || signingPublicKey.length !== sodium.crypto_sign_PUBLICKEYBYTES) {
    return false;
  }
  let message: Uint8Array;
  try {
    message = stageRecordBytes(record);
  } catch {
    return false;
  }
  try {
    return sodium.crypto_sign_verify_detached(signature, message, signingPublicKey);
  } catch {
    return false;
  }
}

// The tracker's integrity check. For each published stage the ballot reached, it reads the published
// record (GET /api/record's source), rebuilds the Merkle tree from the record's ballots with
// @vbt/events' leaf layout and @vbt/crypto, checks the ballot's own leaf and inclusion proof against
// that root, and checks the record's signature. "passed" only when all of that holds; "failed" when
// the ballot is missing, its hash differs, the root differs or the signature is wrong; "unavailable"
// when there is no record, no key or the read failed. It never reports a pass it did not verify.
import "server-only";
import { buildMerkleTree, verifyInclusionProof, verifyStageRecord } from "@vbt/crypto";
import { sortStageLeaves, stageLeaf } from "@vbt/events";
import {
  isRecordStage,
  postgrestRecordSource,
  type PublishedRecord,
  RECORD_STAGES,
  type StageRecordSource,
} from "../../app/api/record/record";
import type { BallotStatus } from "@vbt/domain";
import { loadStageSigningPublicKey } from "../election";
import { recordPageUrl } from "../record/links";
import type { IntegrityCheck } from "./types";
export interface StageRecordRef {
  stage: BallotStatus;
  scope: "precinct" | "county";
  scopeId: string;
  merkleRoot: string;
  signature: string | null;
  publishedOn: string | null;
}

export interface IntegrityChecker {
  /** Is this ballot's ciphertext hash, unchanged, included under the record's Merkle root? */
  check(input: { trackingCode: string; ciphertextHash: string; record: StageRecordRef }): Promise<IntegrityCheck>;
}

export interface RecordReader {
  /** A public link to the published record, or null when none exists. */
  recordUrl(record: StageRecordRef): string | null;
}

const UNAVAILABLE: IntegrityCheck = Object.freeze({ state: "unavailable", proof: null });
const FAILED: IntegrityCheck = Object.freeze({ state: "failed", proof: null });
const PASSED: IntegrityCheck = Object.freeze({ state: "passed", proof: null });

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** One published record, verified once: its rebuilt root, its signature, and each ballot's proof. */
type VerifiedRecord = {
  record: PublishedRecord;
  rootMatches: boolean;
  signatureValid: boolean;
  /** tracking code -> [ciphertext hash in the record, its leaf proof] */
  members: Map<string, { ciphertextHash: string; proof: ReturnType<typeof buildMerkleTree>["proofs"][number] }>;
  root: Uint8Array;
};

/** Published records never change, so each is verified once per server instance and kept. */
const MAX_CACHED = 200;

export function recordIntegrityChecker(
  source: StageRecordSource | null,
  signingPublicKey: Uint8Array | null,
): IntegrityChecker {
  const cache = new Map<string, Promise<VerifiedRecord | null>>();

  async function verify(record: PublishedRecord): Promise<VerifiedRecord> {
    const sorted = sortStageLeaves(record.ballots);
    const tree = buildMerkleTree(sorted.map((b) => stageLeaf(b.tracking_code, b.ciphertext_hash)));
    const signatureValid = signingPublicKey
      ? await verifyStageRecord(
          {
            scope: record.scope,
            stage: record.stage,
            merkleRoot: record.merkle_root,
            ballotCount: record.ballot_count,
            totals: record.totals,
          },
          new Uint8Array(Buffer.from(record.signature, "hex")),
          signingPublicKey,
        )
      : false;
    return {
      record,
      rootMatches: hex(tree.root) === record.merkle_root,
      signatureValid,
      members: new Map(sorted.map((b, i) => [b.tracking_code, { ciphertextHash: b.ciphertext_hash, proof: tree.proofs[i]! }])),
      root: tree.root,
    };
  }

  function load(ref: StageRecordRef): Promise<VerifiedRecord | null> | null {
    if (!source || !isRecordStage(ref.stage) || RECORD_STAGES[ref.stage] !== ref.scope) return null;
    const key = `${ref.scope}/${ref.scopeId}/${ref.stage}/${ref.merkleRoot}`;
    let entry = cache.get(key);
    if (!entry) {
      const stage = ref.stage;
      entry = source.read(ref.scope, ref.scopeId, stage).then((record) => (record ? verify(record) : null));
      // A failed read is not cached, so the next poll tries again.
      entry.catch(() => cache.delete(key));
      if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
      cache.set(key, entry);
    }
    return entry;
  }

  return {
    async check({ trackingCode, ciphertextHash, record: ref }) {
      if (!signingPublicKey) return UNAVAILABLE;
      const pending = load(ref);
      if (!pending) return UNAVAILABLE;
      const verified = await pending;
      if (!verified) return UNAVAILABLE;
      if (verified.record.merkle_root !== ref.merkleRoot) return FAILED;
      if (!verified.rootMatches || !verified.signatureValid) return FAILED;
      const member = verified.members.get(trackingCode);
      if (!member || member.ciphertextHash !== ciphertextHash) return FAILED;
      const included = verifyInclusionProof(stageLeaf(trackingCode, ciphertextHash), member.proof, verified.root);
      return included ? PASSED : FAILED;
    },
  };
}

/**
 * Links each stage to its entry on /record (T-08b), which shows the Merkle root, totals and signature
 * and offers the exact GET /api/record/{scope}/{stage} JSON. Null for a scope id or stage that has
 * no record URL.
 */
export const publishedRecordReader: RecordReader = {
  recordUrl(record) {
    return recordPageUrl(record.scopeId, record.stage);
  },
};

export const defaultIntegrity = {
  checker: recordIntegrityChecker(postgrestRecordSource(), loadStageSigningPublicKey()),
  records: publishedRecordReader,
} as const;

/** Runs a checker, turning a throw or a malformed result into "unavailable" (never "passed"). */
export async function safeCheck(
  checker: IntegrityChecker,
  input: Parameters<IntegrityChecker["check"]>[0],
): Promise<IntegrityCheck> {
  try {
    const result = await checker.check(input);
    if (result && (result.state === "passed" || result.state === "failed" || result.state === "unavailable")) {
      return { state: result.state, proof: result.proof ?? null };
    }
  } catch {
    // Fall through: a failing checker proves nothing either way.
  }
  return UNAVAILABLE;
}

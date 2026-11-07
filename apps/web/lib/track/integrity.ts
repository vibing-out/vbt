// The tracker's integrity check, behind an interface. No crypto lives in apps/web: Merkle proofs,
// leaves and signature checks belong to packages/crypto (T-21) and the record publisher (T-09)
// (CLAUDE.md "crypto only in packages/crypto"; locked-interfaces § Cryptography).
//
// TODO(T-21): when packages/crypto and the stage-record leaf code land, replace
// `pendingIntegrityChecker` and `pendingRecordReader` in `defaultIntegrity` below with real
// implementations. Until then every stage reports "unavailable", never a fake "passed".
import type { BallotStatus } from "@vbt/domain";
import type { IntegrityCheck } from "./types";

/** The public parts of a published stage record a check runs against. */
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

/** Stub until T-21: never claims a check passed. */
export const pendingIntegrityChecker: IntegrityChecker = {
  async check() {
    return UNAVAILABLE;
  },
};

/** Stub until GET /api/record/{scope}/{stage} exists: no link rather than a broken one. */
export const pendingRecordReader: RecordReader = {
  recordUrl() {
    return null;
  },
};

export const defaultIntegrity = { checker: pendingIntegrityChecker, records: pendingRecordReader } as const;

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

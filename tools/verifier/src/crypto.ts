// The verifier's only door to cryptography. Every Merkle, signature and
// tracking-code operation goes through a CryptoAdapter whose functions have
// exactly the signatures of the real @vbt/crypto exports (packages/crypto on
// origin/epic/4: src/index.ts, merkle.ts, stageRecord.ts, trackingCode.ts).
// Nothing else in tools/verifier hashes, signs or builds a tree.
//
// packages/crypto is not on this branch yet. Until E3 merges, `realCrypto`
// throws CryptoUnavailableError and the CLI exits 2 ("could not verify").
// When E3 lands, replace the body of `realCrypto` with:
//
//   import * as crypto from "@vbt/crypto";
//   export const realCrypto: CryptoAdapter = {
//     ready: crypto.ready,
//     isTrackingCode: crypto.isTrackingCode,
//     buildMerkleTree: crypto.buildMerkleTree,
//     verifyInclusionProof: crypto.verifyInclusionProof,
//     verifyStageRecord: crypto.verifyStageRecord,
//   };
//
// and replace the type mirrors below with `import type` from @vbt/crypto.
//
// Follow-up: @vbt/crypto exports no event-hash function, so the chain check
// verifies linkage only. Recomputing each event's hash needs an `eventHash`
// export from packages/crypto, added to this adapter.

// --- Type mirrors of @vbt/crypto (index.ts exports). Do not change them here. ---

/** contestId → choiceId → count. Aggregate only; never per ballot. */
export type ContestTotals = Record<string, Record<string, number>>;

/** One step of an inclusion proof: the sibling hash and which side it sits on. */
export type ProofStep = { sibling: Uint8Array; side: "left" | "right" };

export type InclusionProof = {
  /** Position of the leaf in the input order. The verifier never sets or prints it. */
  leafIndex?: number;
  /** Siblings from the leaf level up to (not including) the root. */
  steps: ProofStep[];
};

/** The signed part of a published per-stage record. */
export type StageRecord = {
  scope: string;
  stage: string;
  /** Lowercase hex of the 32-byte Merkle root. */
  merkleRoot: string;
  ballotCount: number;
  totals: ContestTotals;
};

// --- The adapter ---

export interface CryptoAdapter {
  ready(): Promise<void>;
  isTrackingCode(code: unknown): code is string;
  buildMerkleTree(leaves: readonly Uint8Array[]): { root: Uint8Array; proofs: InclusionProof[] };
  verifyInclusionProof(leaf: Uint8Array, proof: InclusionProof, root: Uint8Array): boolean;
  verifyStageRecord(record: StageRecord, signature: Uint8Array, signingPublicKey: Uint8Array): Promise<boolean>;
}

export const CRYPTO_UNAVAILABLE = "packages/crypto is not on this branch yet: it lands with E3";

export class CryptoUnavailableError extends Error {
  constructor() {
    super(CRYPTO_UNAVAILABLE);
    this.name = "CryptoUnavailableError";
  }
}

function unavailable(): never {
  throw new CryptoUnavailableError();
}

export const realCrypto: CryptoAdapter = {
  ready: async () => unavailable(),
  isTrackingCode: (_code: unknown): _code is string => unavailable(),
  buildMerkleTree: () => unavailable(),
  verifyInclusionProof: () => unavailable(),
  verifyStageRecord: async () => unavailable(),
};

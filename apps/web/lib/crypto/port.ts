// The @vbt/crypto surface T-09 uses, declared here until E3 is on main.
//
// Types and signatures copied verbatim from origin/epic/4 (E3 Core engine, PR #40) at commit
// ca87bd3a7a26d2f0be84b6015b1e1804e16520bf: packages/crypto/src/{ready,merkle,stageRecord,aggregate,manifest}.ts.
// Replace with `import type { StageRecord, ContestTotals, ElectionManifest, InclusionProof, ProofStep }
// from "@vbt/crypto"` (and the functions themselves) when E3 is on main.
//
// No crypto code runs here. apps/web/lib/crypto/index.ts provides the implementation; until E3 lands every
// member fails with "stage records publish once E3 lands", and nothing ever publishes a placeholder.

/** JSON manifest of contests and choices, published in the election record. */
export type ElectionManifest = {
  contests: ReadonlyArray<{ id: string; choices: ReadonlyArray<{ id: string }> }>;
};

/** contestId → choiceId → count. Aggregate only; never per ballot. */
export type ContestTotals = Record<string, Record<string, number>>;

/** One step of an inclusion proof: the sibling hash and which side it sits on. */
export type ProofStep = { sibling: Uint8Array; side: "left" | "right" };

export type InclusionProof = {
  /** Position of the leaf in the input order. Informational; not needed to verify. */
  leafIndex?: number;
  /** Siblings from the leaf level up to (not including) the root. */
  steps: ProofStep[];
};

/** The signed part of a published per-stage record (stage_records row). */
export type StageRecord = {
  scope: string;
  stage: string;
  /** Lowercase hex of the 32-byte Merkle root. */
  merkleRoot: string;
  ballotCount: number;
  totals: ContestTotals;
};

/** The @vbt/crypto functions T-09 calls (verifyInclusionProof is declared only). */
export interface CryptoPort {
  ready(): Promise<void>;
  buildMerkleTree(leaves: readonly Uint8Array[]): { root: Uint8Array; proofs: InclusionProof[] };
  verifyInclusionProof(leaf: Uint8Array, proof: InclusionProof, root: Uint8Array): boolean;
  signStageRecord(record: StageRecord, signingSecretKey: Uint8Array): Promise<Uint8Array>;
  verifyStageRecord(record: StageRecord, signature: Uint8Array, signingPublicKey: Uint8Array): Promise<boolean>;
  aggregateDecrypt(
    ciphertexts: readonly Uint8Array[],
    electionSecretKey: Uint8Array,
    manifest: ElectionManifest,
  ): Promise<ContestTotals>;
}

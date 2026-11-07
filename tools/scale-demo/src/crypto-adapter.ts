// The only way the scale seed touches cryptography (T-11).
//
// @vbt/crypto lives on epic/4 (E3) and is not on this base yet, and no crypto is written here: hashing,
// signing, Merkle trees and hash chains belong in packages/crypto (CLAUDE.md "Records stay verifiable").
// So every call goes through this adapter, and the default adapter, pendingCrypto, throws from every
// method. Nothing reaches a database until E3 merges and a follow-up swaps in the real functions.
//
// The first eight members mirror epic/4's @vbt/crypto signatures exactly (packages/crypto/src/keys.ts,
// sealedBallot.ts, trackingCode.ts, merkle.ts, aggregate.ts, stageRecord.ts at ca87bd3a). Their types
// are re-declared below, field for field, until the package is on this base.
// ciphertextHash and eventHash have no epic/4 export yet; which package supplies them is open (PR body).

/** keys.ts KeyPair. */
export type KeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };

/** manifest.ts ElectionManifest. */
export type ElectionManifest = {
  contests: ReadonlyArray<{ id: string; choices: ReadonlyArray<{ id: string }> }>;
};

/** manifest.ts BallotPlaintext. */
export type BallotPlaintext = {
  contests: ReadonlyArray<{ contestId: string; choiceIds: ReadonlyArray<string> }>;
};

/** manifest.ts ContestTotals: contestId → choiceId → count. */
export type ContestTotals = Record<string, Record<string, number>>;

/** stageRecord.ts StageRecord: the signed part of a stage_records row. */
export type StageRecord = {
  scope: string;
  stage: string;
  /** Lowercase hex of the 32-byte Merkle root. */
  merkleRoot: string;
  ballotCount: number;
  totals: ContestTotals;
};

/** merkle.ts ProofStep and InclusionProof. */
export type ProofStep = { sibling: Uint8Array; side: "left" | "right" };
export type InclusionProof = { leafIndex?: number; steps: ProofStep[] };

/** The public fields an event hash covers: the date, never a time (20261107190000 item 3). */
export type EventHashInput = {
  prevHash: string | null;
  ballotId: string;
  precinctId: string;
  countyId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  /** YYYY-MM-DD only. */
  occurredOn: string;
};

export interface CryptoAdapter {
  generateSigningKeyPair(): Promise<KeyPair>;
  encryptBallot(plaintext: BallotPlaintext, electionPublicKey: Uint8Array): Promise<Uint8Array>;
  computeTrackingCode(ciphertext: Uint8Array, prevTrackingCode: string | null): string;
  isTrackingCode(code: unknown): code is string;
  buildMerkleTree(leaves: readonly Uint8Array[]): { root: Uint8Array; proofs: InclusionProof[] };
  aggregateDecrypt(ciphertexts: readonly Uint8Array[], electionSecretKey: Uint8Array, manifest: ElectionManifest): Promise<ContestTotals>;
  signStageRecord(record: StageRecord, signingSecretKey: Uint8Array): Promise<Uint8Array>;
  verifyStageRecord(record: StageRecord, signature: Uint8Array, signingPublicKey: Uint8Array): Promise<boolean>;
  // No epic/4 export yet:
  /** Lowercase hex SHA-256 of the ciphertext bytes. */
  ciphertextHash(ciphertext: Uint8Array): string;
  /** Lowercase hex hash of one event, chaining prevHash. */
  eventHash(input: EventHashInput): string;
}

export const E3_PENDING = "crypto lands with E3 (epic #4): @vbt/crypto is not on this base yet";

const pending = (method: keyof CryptoAdapter) => (): never => {
  throw new Error(`${E3_PENDING} (${method})`);
};

/** The default adapter until E3: every method throws, so no placeholder crypto is ever written. */
export const pendingCrypto: CryptoAdapter = Object.freeze({
  generateSigningKeyPair: pending("generateSigningKeyPair"),
  encryptBallot: pending("encryptBallot"),
  computeTrackingCode: pending("computeTrackingCode"),
  isTrackingCode: pending("isTrackingCode") as unknown as CryptoAdapter["isTrackingCode"],
  buildMerkleTree: pending("buildMerkleTree"),
  aggregateDecrypt: pending("aggregateDecrypt"),
  signStageRecord: pending("signStageRecord"),
  verifyStageRecord: pending("verifyStageRecord"),
  ciphertextHash: pending("ciphertextHash"),
  eventHash: pending("eventHash"),
});

/** The adapter the real CLI uses. Swapped for @vbt/crypto's functions by the follow-up after E3. */
export const DEFAULT_CRYPTO: CryptoAdapter = pendingCrypto;

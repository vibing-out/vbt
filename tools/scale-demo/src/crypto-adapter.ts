// The only way the scale seed touches cryptography (T-11).
//
// Hashing, signing, Merkle trees and hash chains belong in packages/crypto and packages/events (CLAUDE.md
// "Records stay verifiable"), so every call goes through this adapter. realCrypto, the CLI's adapter, is
// those packages' functions and nothing else. Tests pass a fake with readable ciphertexts instead, and
// runSeed accepts a non-default adapter only with a localhost database.
//
// eventHash and ciphertextHash are @vbt/events' hashEvent and sha256Hex: the same event chain and
// ciphertext hash the ingest and batch code write (T-05 C8), so the tracker verifies seeded ballots
// exactly as it verifies uploaded ones.

import {
  aggregateDecrypt,
  type BallotPlaintext,
  buildMerkleTree,
  type ContestTotals,
  computeTrackingCode,
  type ElectionManifest,
  encryptBallot,
  generateSigningKeyPair,
  type InclusionProof,
  isTrackingCode,
  signStageRecord,
  type StageRecord,
  verifyStageRecord,
} from "@vbt/crypto";
import { type ChainFields, hashEvent, sha256Hex } from "@vbt/events";

export type { BallotPlaintext, ChainFields, ContestTotals, ElectionManifest, StageRecord };

/** keys.ts KeyPair (not re-exported by @vbt/crypto). */
export type KeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };

export interface CryptoAdapter {
  generateSigningKeyPair(): Promise<KeyPair>;
  encryptBallot(plaintext: BallotPlaintext, electionPublicKey: Uint8Array): Promise<Uint8Array>;
  computeTrackingCode(ciphertext: Uint8Array, prevTrackingCode: string | null): string;
  isTrackingCode(code: unknown): code is string;
  buildMerkleTree(leaves: readonly Uint8Array[]): { root: Uint8Array; proofs: InclusionProof[] };
  aggregateDecrypt(ciphertexts: readonly Uint8Array[], electionSecretKey: Uint8Array, manifest: ElectionManifest): Promise<ContestTotals>;
  signStageRecord(record: StageRecord, signingSecretKey: Uint8Array): Promise<Uint8Array>;
  verifyStageRecord(record: StageRecord, signature: Uint8Array, signingPublicKey: Uint8Array): Promise<boolean>;
  /** Lowercase hex SHA-256 of the ciphertext bytes. */
  ciphertextHash(ciphertext: Uint8Array): string;
  /** Lowercase hex hash of one event over the locked chain fields (tracking code, date only). */
  eventHash(input: ChainFields): string;
}

/** The CLI's adapter: @vbt/crypto and @vbt/events, unchanged. */
export const realCrypto: CryptoAdapter = Object.freeze({
  generateSigningKeyPair,
  encryptBallot,
  computeTrackingCode,
  isTrackingCode,
  buildMerkleTree,
  aggregateDecrypt,
  signStageRecord,
  verifyStageRecord,
  ciphertextHash: (ciphertext: Uint8Array) => sha256Hex(ciphertext),
  eventHash: (input: ChainFields) => hashEvent(input),
});

/** The adapter the real CLI uses. */
export const DEFAULT_CRYPTO: CryptoAdapter = realCrypto;

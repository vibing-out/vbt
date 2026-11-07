// Test-only: a deterministic stand-in for @vbt/crypto, injected through the CryptoPort adapter. Never
// imported by app code (lib/crypto/index.test.ts checks). It is NOT cryptography: its "ciphertexts" are
// base64 JSON plaintexts, its root is a hash of the sorted leaves and its "signature" an HMAC.
import { createHash, createHmac } from "node:crypto";
import type { CryptoKeys } from "../crypto";
import type { ContestTotals, CryptoPort, ElectionManifest, StageRecord } from "../crypto/port";

const KEY = new Uint8Array(Buffer.from("fake-stage-signing-key-for-tests"));
export const FAKE_KEYS: CryptoKeys = { electionSecretKey: new Uint8Array(32), signingSecretKey: KEY, signingPublicKey: KEY };

export interface FakePlaintext {
  contests: Array<{ contestId: string; choiceIds: string[] }>;
}

/** A fake "ciphertext" (as stored in ballots.ciphertext): base64 of the plaintext JSON. */
export function fakeCiphertext(plaintext: FakePlaintext): string {
  return Buffer.from(JSON.stringify(plaintext)).toString("base64");
}

function canonical(record: StageRecord): string {
  const sortKeys = (value: unknown): unknown =>
    value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]))
      : value;
  const { scope, stage, merkleRoot, ballotCount, totals } = record;
  return JSON.stringify(sortKeys({ scope, stage, merkleRoot, ballotCount, totals }));
}

const hmac = (record: StageRecord, key: Uint8Array) => new Uint8Array(createHmac("sha256", key).update(canonical(record)).digest());

/** The fake root for a list of leaves: sha256("fake:" + sorted hex leaves). */
export function fakeRoot(leaves: readonly Uint8Array[]): Uint8Array {
  const hex = leaves.map((l) => Buffer.from(l).toString("hex")).sort();
  return new Uint8Array(createHash("sha256").update(`fake:${hex.join(",")}`).digest());
}

export function fakeCrypto(): CryptoPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async ready() {
      calls.push("ready");
    },
    buildMerkleTree(leaves) {
      calls.push("buildMerkleTree");
      return { root: fakeRoot(leaves), proofs: [] };
    },
    verifyInclusionProof() {
      calls.push("verifyInclusionProof");
      return false;
    },
    async signStageRecord(record, key) {
      calls.push("signStageRecord");
      return hmac(record, key);
    },
    async verifyStageRecord(record, signature, key) {
      calls.push("verifyStageRecord");
      return Buffer.from(hmac(record, key)).equals(Buffer.from(signature));
    },
    async aggregateDecrypt(ciphertexts, _key, manifest: ElectionManifest): Promise<ContestTotals> {
      calls.push("aggregateDecrypt");
      const totals: ContestTotals = Object.create(null);
      for (const contest of manifest.contests) {
        totals[contest.id] = Object.create(null);
        for (const choice of contest.choices) totals[contest.id]![choice.id] = 0;
      }
      ciphertexts.forEach((bytes, index) => {
        const ballot = JSON.parse(Buffer.from(bytes).toString()) as FakePlaintext;
        for (const { contestId, choiceIds } of ballot.contests) {
          const row = Object.hasOwn(totals, contestId) ? totals[contestId] : undefined;
          if (!row) throw new Error(`ballot ${index}: contest not in manifest`);
          for (const choiceId of choiceIds) {
            if (!Object.hasOwn(row, choiceId)) throw new Error(`ballot ${index}: choice not in manifest`);
            row[choiceId] = row[choiceId]! + 1;
          }
        }
      });
      return totals;
    },
  };
}

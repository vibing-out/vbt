// Test-only: a fake CryptoAdapter so the seed can be exercised before E3. Its "ciphertexts" are
// readable JSON and its signatures are plain hashes: worthless as crypto, and runSeed accepts it only
// with a localhost database (scratch databases the tests create and drop). Never imported by the CLI.

import { createHash } from "node:crypto";
import type { CryptoAdapter, StageRecord } from "../crypto-adapter.ts";

// epic/4 packages/crypto/src/trackingCode.ts TRACKING_CODE_PATTERN.
const TRACKING_CODE_PATTERN = /^[A-Z]{3,8}-[A-Z]{3,8}-[0-9A-HJKMNP-TV-Z]{4}-[A-Z]{3,8}$/;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const WORDS = ["AMBER", "BIRCH", "CEDAR", "DELTA", "EMBER", "FJORD", "GROVE", "HARBOR"];

const sha = (data: string | Uint8Array) => createHash("sha256").update(data).digest();
const text = new TextDecoder();

export interface FakeCrypto extends CryptoAdapter {
  /** Leaves passed to each buildMerkleTree call, as hex. */
  readonly merkleCalls: string[][];
  readonly prevCodes: Array<string | null>;
}

export function fakeCrypto(): FakeCrypto {
  let keys = 0;
  let ballots = 0;
  let codes = 0;
  const merkleCalls: string[][] = [];
  const prevCodes: Array<string | null> = [];
  const signature = (record: StageRecord, key: Uint8Array) =>
    new Uint8Array(sha(JSON.stringify([record.scope, record.stage, record.merkleRoot, record.ballotCount, record.totals, Buffer.from(key).toString("hex")])));

  return {
    merkleCalls,
    prevCodes,
    async generateSigningKeyPair() {
      keys += 1;
      return { publicKey: new Uint8Array(sha(`pk-${keys}`)), secretKey: new Uint8Array(sha(`sk-${keys}`)) };
    },
    async encryptBallot(plaintext) {
      ballots += 1;
      return new TextEncoder().encode(JSON.stringify({ fake: ballots, plaintext }));
    },
    computeTrackingCode(ciphertext, prev) {
      prevCodes.push(prev);
      const h = sha(Buffer.concat([Buffer.from(ciphertext), Buffer.from(prev ?? "")]));
      let n = codes++;
      let middle = "";
      for (let i = 0; i < 4; i++) {
        middle = CROCKFORD[n % 32] + middle;
        n = Math.floor(n / 32);
      }
      return `${WORDS[h[0]! % WORDS.length]}-${WORDS[h[1]! % WORDS.length]}-${middle}-FAKE`;
    },
    isTrackingCode(code: unknown): code is string {
      return typeof code === "string" && TRACKING_CODE_PATTERN.test(code);
    },
    buildMerkleTree(leaves) {
      merkleCalls.push(leaves.map((l) => Buffer.from(l).toString("hex")));
      return { root: new Uint8Array(sha(Buffer.concat(leaves.map((l) => Buffer.from(l))))), proofs: [] };
    },
    async aggregateDecrypt(ciphertexts, _secretKey, manifest) {
      const totals: Record<string, Record<string, number>> = {};
      for (const contest of manifest.contests) totals[contest.id] = Object.fromEntries(contest.choices.map((c) => [c.id, 0]));
      for (const ct of ciphertexts) {
        const { plaintext } = JSON.parse(text.decode(ct)) as { plaintext: { contests: Array<{ contestId: string; choiceIds: string[] }> } };
        for (const c of plaintext.contests) for (const id of c.choiceIds) totals[c.contestId]![id]! += 1;
      }
      return totals;
    },
    async signStageRecord(record, secretKey) {
      return signature(record, secretKey);
    },
    async verifyStageRecord(record, sig, publicKey) {
      // The fake "key pair" is one shared key: FAKE_KEYS uses the same bytes for both halves.
      return Buffer.from(signature(record, publicKey)).equals(Buffer.from(sig));
    },
    ciphertextHash(ciphertext) {
      return sha(ciphertext).toString("hex");
    },
    eventHash(input) {
      return sha(JSON.stringify(input)).toString("hex");
    },
  };
}

/** Base64 key env for the fake (the stage "key pair" is the same bytes twice, so the fake verifies). */
export const FAKE_KEY_ENV = Object.freeze({
  ELECTION_PUBLIC_KEY: Buffer.from("fake-election-public").toString("base64"),
  ELECTION_SECRET_KEY: Buffer.from("fake-election-secret").toString("base64"),
  STAGE_SIGNING_PUBLIC_KEY: Buffer.from("fake-stage-key").toString("base64"),
  STAGE_SIGNING_SECRET_KEY: Buffer.from("fake-stage-key").toString("base64"),
});

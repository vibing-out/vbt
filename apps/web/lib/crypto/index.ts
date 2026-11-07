import "server-only";

import type { BatchTotals } from "@vbt/domain";
import type { ContestTotals, CryptoPort } from "./port";

// The one adapter between apps/web and @vbt/crypto (approver decision on #19).
//
// @vbt/crypto lives on origin/epic/4 (E3) and is not on this epic. Until E3 is on main, getCrypto()
// returns `unavailable`: every member fails with CryptoUnavailableError, so a batch publishes no stage
// record and moves no ballot (the API answers 503 "stage records publish once E3 lands"). Nothing here
// ever returns a placeholder root, signature or totals.
//
// When E3 merges: add "@vbt/crypto": "workspace:*" to apps/web/package.json, make getCrypto() return
// { ready, buildMerkleTree, verifyInclusionProof, signStageRecord, verifyStageRecord, aggregateDecrypt }
// from "@vbt/crypto", switch port.ts to `import type` from it, and delete `unavailable`.
//
// This is the only module that reads the election and stage-signing keys.

export const CRYPTO_UNAVAILABLE = "stage records publish once E3 lands";

export class CryptoUnavailableError extends Error {
  constructor() {
    super(CRYPTO_UNAVAILABLE);
    this.name = "CryptoUnavailableError";
  }
}

const fail = (): never => {
  throw new CryptoUnavailableError();
};

/** Until E3 lands: every call fails (async members reject, sync members throw). */
export const unavailable: CryptoPort = Object.freeze({
  ready: async () => fail(),
  buildMerkleTree: () => fail(),
  verifyInclusionProof: () => fail(),
  signStageRecord: async () => fail(),
  verifyStageRecord: async () => fail(),
  aggregateDecrypt: async () => fail(),
});

export function getCrypto(): CryptoPort {
  return unavailable;
}

export interface CryptoKeys {
  electionSecretKey: Uint8Array;
  signingSecretKey: Uint8Array;
  signingPublicKey: Uint8Array;
}

export class CryptoKeysMissingError extends Error {
  constructor() {
    super("election crypto keys are not configured");
    this.name = "CryptoKeysMissingError";
  }
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function key(value: string | undefined): Uint8Array {
  const text = value?.trim() ?? "";
  if (text === "" || !BASE64.test(text)) throw new CryptoKeysMissingError();
  return new Uint8Array(Buffer.from(text, "base64"));
}

/** The keys for aggregate decryption and stage-record signing (base64 in env; server only). */
export function keys(env: Readonly<Record<string, string | undefined>> = process.env): CryptoKeys {
  return {
    electionSecretKey: key(env.ELECTION_SECRET_KEY),
    signingSecretKey: key(env.STAGE_SIGNING_SECRET_KEY),
    signingPublicKey: key(env.STAGE_SIGNING_PUBLIC_KEY),
  };
}

/** @vbt/crypto's ContestTotals with a ballot count, as @vbt/domain's cross-checks compare them. */
export function toTotals(contests: ContestTotals, ballotCount: number): BatchTotals {
  return { ballotCount, contests };
}

const HEX = /^(?:[0-9a-f]{2})+$/;

export function hexToBytes(hex: string): Uint8Array {
  if (!HEX.test(hex)) throw new TypeError("not lowercase hex");
  return new Uint8Array(Buffer.from(hex, "hex"));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** A stored ciphertext (base64 text in ballots.ciphertext) as the bytes @vbt/crypto opens. */
export function ciphertextBytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}

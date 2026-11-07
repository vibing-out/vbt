// Merkle leaves of a published stage record (T-05 C17). This is the one place their byte layout
// lives; the tracker, the published record and the verifier (T-15) all build leaves here.
//
//   leaf = UTF-8(tracking_code) || 0x00 || ciphertext_hash (32 raw bytes)
//
// Leaves are ordered ascending by ciphertext_hash, then tracking_code: never by cast order, so a
// leaf's position says nothing about when the ballot was cast (locked principle 5). @vbt/crypto's
// buildMerkleTree adds its own 0x00 leaf / 0x01 node domain separation on top.

import { hexToBytes, isSha256Hex } from "./hash.ts";

export type LeafSource = { tracking_code: string; ciphertext_hash: string };

const SEPARATOR = 0x00;

/** The leaf bytes for one ballot. Throws on an empty code, a code holding 0x00, or a malformed hash. */
export function stageLeaf(trackingCode: string, ciphertextHash: string): Uint8Array {
  if (typeof trackingCode !== "string" || trackingCode === "" || trackingCode.includes("\u0000")) {
    throw new TypeError("trackingCode must be a non-empty string without NUL");
  }
  if (!isSha256Hex(ciphertextHash)) throw new TypeError("ciphertextHash must be 64 lowercase hex characters");
  const code = new TextEncoder().encode(trackingCode);
  const leaf = new Uint8Array(code.length + 1 + 32);
  leaf.set(code, 0);
  leaf[code.length] = SEPARATOR;
  leaf.set(hexToBytes(ciphertextHash), code.length + 1);
  return leaf;
}

/** Code-unit order, so every machine sorts the same way (never localeCompare). */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A sorted copy: ascending ciphertext_hash, then tracking_code. The input order is ignored. */
export function sortStageLeaves<T extends LeafSource>(ballots: readonly T[]): T[] {
  return [...ballots].sort(
    (a, b) => compare(a.ciphertext_hash, b.ciphertext_hash) || compare(a.tracking_code, b.tracking_code),
  );
}

/** The ordered leaf bytes for a stage record. */
export function stageLeaves(ballots: readonly LeafSource[]): Uint8Array[] {
  return sortStageLeaves(ballots).map((b) => stageLeaf(b.tracking_code, b.ciphertext_hash));
}

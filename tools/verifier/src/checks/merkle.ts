// merkle-root, leaf-order and ballot-count: the record's listed ballots
// against its published root and count. Leaves are the ciphertext_hash bytes
// in listed order; the tree is built by the crypto adapter.

import type { CryptoAdapter } from "../crypto.ts";
import { bytesToHex, hexToBytes, type PublishedRecord } from "../record.ts";
import { type Check, fail, outcome, pass } from "../report.ts";

export function checkMerkleRoot(crypto: CryptoAdapter, r: PublishedRecord): Check {
  const root = bytesToHex(crypto.buildMerkleTree(r.ballots.map((b) => hexToBytes(b.ciphertext_hash))).root);
  return root === r.merkle_root
    ? pass("merkle-root", r.scope_id, r.stage)
    : fail("merkle-root", r.scope_id, r.stage, `recomputed root ${root} != published root ${r.merkle_root}`);
}

/**
 * Ballots must be in strictly increasing ciphertext_hash order: any other order
 * (such as insertion order) could leak casting order, and an equal neighbour is
 * the same ballot listed twice. Messages never name the position or the hash.
 */
export function checkLeafOrder(r: PublishedRecord): Check {
  let unsorted = false;
  let repeated = false;
  for (let i = 1; i < r.ballots.length; i++) {
    const a = (r.ballots[i - 1] as PublishedRecord["ballots"][number]).ciphertext_hash;
    const b = (r.ballots[i] as PublishedRecord["ballots"][number]).ciphertext_hash;
    if (a > b) unsorted = true;
    else if (a === b) repeated = true;
  }
  if (unsorted) return fail("leaf-order", r.scope_id, r.stage, "ballots are not sorted by ciphertext hash");
  if (repeated) return fail("leaf-order", r.scope_id, r.stage, "ballots list the same ciphertext hash more than once");
  return pass("leaf-order", r.scope_id, r.stage);
}

/** Tracking codes listed more than once, sorted alphabetically. */
export function repeatedCodes(codes: Iterable<string>): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const code of codes) (seen.has(code) ? repeated : seen).add(code);
  return [...repeated].sort();
}

/** `<k> tracking codes are listed more than once<where>: <first 5 codes>`. */
export const repeatedMessage = (codes: string[], where = ""): string =>
  `${codes.length} tracking codes are listed more than once${where}: ${codes.slice(0, 5).join(", ")}`;

/** ballot_count equals the number listed, and no tracking code is listed twice (a duplicate would count one ballot twice). */
export function checkBallotCount(r: PublishedRecord): Check[] {
  const failures: string[] = [];
  if (r.ballot_count !== r.ballots.length) failures.push(`ballot_count ${r.ballot_count} != ${r.ballots.length} ballots listed`);
  const repeated = repeatedCodes(r.ballots.map((b) => b.tracking_code));
  if (repeated.length > 0) failures.push(repeatedMessage(repeated));
  return outcome("ballot-count", r.scope_id, r.stage, failures);
}

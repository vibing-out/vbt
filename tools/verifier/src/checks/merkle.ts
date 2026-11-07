// merkle-root, leaf-order and ballot-count: the record's listed ballots
// against its published root and count. Leaves are the ciphertext_hash bytes
// in listed order; the tree is built by the crypto adapter.

import type { CryptoAdapter } from "../crypto.ts";
import { bytesToHex, hexToBytes, type PublishedRecord } from "../record.ts";
import { type Check, fail, pass } from "../report.ts";

export function checkMerkleRoot(crypto: CryptoAdapter, r: PublishedRecord): Check {
  const root = bytesToHex(crypto.buildMerkleTree(r.ballots.map((b) => hexToBytes(b.ciphertext_hash))).root);
  return root === r.merkle_root
    ? pass("merkle-root", r.scope_id, r.stage)
    : fail("merkle-root", r.scope_id, r.stage, `recomputed root ${root} != published root ${r.merkle_root}`);
}

/** Ballots must be sorted by ciphertext_hash: any other order (such as insertion order) could leak casting order. */
export function checkLeafOrder(r: PublishedRecord): Check {
  const sorted = r.ballots.every((b, i) => i === 0 || (r.ballots[i - 1] as typeof b).ciphertext_hash <= b.ciphertext_hash);
  return sorted
    ? pass("leaf-order", r.scope_id, r.stage)
    : fail("leaf-order", r.scope_id, r.stage, "ballots are not sorted by ciphertext hash");
}

export function checkBallotCount(r: PublishedRecord): Check {
  return r.ballot_count === r.ballots.length
    ? pass("ballot-count", r.scope_id, r.stage)
    : fail("ballot-count", r.scope_id, r.stage, `ballot_count ${r.ballot_count} != ${r.ballots.length} ballots listed`);
}

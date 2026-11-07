// inclusion: one tracking code's proof for a stage reaches that stage
// record's published root, and the record lists the code with the same
// ciphertext hash. The proof is verified by the crypto adapter; its leaf
// index is never read or printed.

import type { CryptoAdapter } from "../crypto.ts";
import { hexToBytes, type PublishedProof, type PublishedRecord, type PublishedTrack } from "../record.ts";
import { type Check, outcome } from "../report.ts";

export function checkInclusion(
  crypto: CryptoAdapter,
  code: string,
  track: PublishedTrack,
  proof: PublishedProof,
  record: PublishedRecord,
): Check[] {
  const failures: string[] = [];
  const listed = record.ballots.some((b) => b.tracking_code === code && b.ciphertext_hash === track.ciphertext_hash);
  if (!listed) failures.push(`code not in ${record.scope_id}/${record.stage}`);
  const reaches = crypto.verifyInclusionProof(
    hexToBytes(track.ciphertext_hash),
    { steps: proof.path.map((s) => ({ side: s.side, sibling: hexToBytes(s.hash) })) },
    hexToBytes(record.merkle_root),
  );
  if (!reaches) failures.push("proof does not reach the published root");
  return outcome("inclusion", code, proof.stage, failures);
}

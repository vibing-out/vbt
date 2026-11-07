// signature: the stage record's Ed25519 signature, checked through the crypto
// adapter against the key the user supplied (never one fetched from the server).

import type { CryptoAdapter } from "../crypto.ts";
import { hexToBytes, type PublishedRecord } from "../record.ts";
import { type Check, fail, pass } from "../report.ts";

export const NO_KEY_MESSAGE = "no stage signing public key given (use --public-key or STAGE_SIGNING_PUBLIC_KEY)";

export async function checkSignature(crypto: CryptoAdapter, r: PublishedRecord, publicKey: Uint8Array | null): Promise<Check> {
  if (!publicKey) return fail("signature", r.scope_id, r.stage, NO_KEY_MESSAGE);
  const ok = await crypto.verifyStageRecord(
    { scope: r.scope_id, stage: r.stage, merkleRoot: r.merkle_root, ballotCount: r.ballot_count, totals: r.totals },
    hexToBytes(r.signature),
    publicKey,
  );
  return ok
    ? pass("signature", r.scope_id, r.stage)
    : fail("signature", r.scope_id, r.stage, "signature does not match the stage signing key");
}

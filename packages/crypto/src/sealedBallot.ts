import { assertBytes, utf8 } from "./internal/bytes.js";
import { canonicalJson } from "./internal/canonicalJson.js";
import { assertBallotShape, type BallotPlaintext } from "./manifest.js";
import { getSodium } from "./ready.js";

/**
 * Plaintext is padded (ISO/IEC 7816-4, libsodium `sodium_pad`) to a multiple
 * of this many bytes before sealing, so the published ciphertext length does
 * not reveal which choices were made (choice ids differ in length).
 */
export const BALLOT_PAD_BLOCK = 512;

/** Internal: canonical JSON bytes of a ballot, before padding. */
export function serializeBallot(plaintext: BallotPlaintext): Uint8Array {
  assertBallotShape(plaintext);
  return utf8(
    canonicalJson({
      contests: plaintext.contests.map((c) => ({ contestId: c.contestId, choiceIds: [...c.choiceIds] })),
    }),
  );
}

/** Seal a ballot to the election public key (libsodium crypto_box_seal). */
export async function encryptBallot(plaintext: BallotPlaintext, electionPublicKey: Uint8Array): Promise<Uint8Array> {
  const sodium = await getSodium();
  assertBytes(electionPublicKey, "electionPublicKey", sodium.crypto_box_PUBLICKEYBYTES);
  const raw = serializeBallot(plaintext);
  const padded = sodium.pad(raw, BALLOT_PAD_BLOCK);
  try {
    return sodium.crypto_box_seal(padded, electionPublicKey);
  } finally {
    sodium.memzero(raw);
    sodium.memzero(padded);
  }
}

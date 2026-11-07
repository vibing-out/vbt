// Internal only. Never export from src/index.ts: individual decrypted ballots
// must not leave this package (locked Cryptography: decrypt in aggregate only).
import { BALLOT_PAD_BLOCK } from "../sealedBallot.js";
import { assertBallotShape, type BallotPlaintext } from "../manifest.js";
import type { Sodium } from "../ready.js";

export class BallotDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BallotDecryptError";
  }
}

/**
 * Open one sealed ballot. Throws BallotDecryptError if the ciphertext was
 * tampered with, sealed to another key, or does not hold a valid ballot.
 * The error never includes plaintext.
 */
export function openSealedBallot(
  sodium: Sodium,
  ciphertext: Uint8Array,
  electionPublicKey: Uint8Array,
  electionSecretKey: Uint8Array,
): BallotPlaintext {
  let padded: Uint8Array;
  try {
    padded = sodium.crypto_box_seal_open(ciphertext, electionPublicKey, electionSecretKey);
  } catch {
    throw new BallotDecryptError("sealed box failed to open");
  }
  let raw: Uint8Array | undefined;
  try {
    raw = sodium.unpad(padded, BALLOT_PAD_BLOCK);
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    assertBallotShape(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof BallotDecryptError) throw error;
    throw new BallotDecryptError("sealed box opened but does not hold a valid ballot");
  } finally {
    if (raw) sodium.memzero(raw);
    sodium.memzero(padded);
  }
}

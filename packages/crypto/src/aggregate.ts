import { assertBytes } from "./internal/bytes.js";
import { BallotDecryptError, openSealedBallot } from "./internal/decrypt.js";
import { assertValidManifest, zeroTotals, type ContestTotals, type ElectionManifest } from "./manifest.js";
import { getSodium } from "./ready.js";

/**
 * Decrypt a set of sealed ballots and return only their combined totals.
 * Individual plaintexts never leave this function.
 *
 * All-or-nothing: if any ciphertext fails to open, or holds a contest or
 * choice the manifest does not list, the whole call throws and no totals are
 * returned. The error names the ballot's position in `ciphertexts` but never
 * its contents.
 */
export async function aggregateDecrypt(
  ciphertexts: readonly Uint8Array[],
  electionSecretKey: Uint8Array,
  manifest: ElectionManifest,
): Promise<ContestTotals> {
  const sodium = await getSodium();
  assertBytes(electionSecretKey, "electionSecretKey", sodium.crypto_box_SECRETKEYBYTES);
  assertValidManifest(manifest);
  if (!Array.isArray(ciphertexts)) throw new TypeError("ciphertexts must be an array");

  const publicKey = sodium.crypto_scalarmult_base(electionSecretKey);
  const totals = zeroTotals(manifest);

  ciphertexts.forEach((ciphertext, index) => {
    assertBytes(ciphertext, `ciphertexts[${index}]`);
    let ballot;
    try {
      ballot = openSealedBallot(sodium, ciphertext, publicKey, electionSecretKey);
    } catch (error) {
      if (error instanceof BallotDecryptError) {
        throw new BallotDecryptError(`ballot ${index}: ${error.message}`);
      }
      throw error;
    }
    for (const { contestId, choiceIds } of ballot.contests) {
      const row = totals[contestId];
      if (!row) throw new BallotDecryptError(`ballot ${index}: contest not in manifest`);
      for (const choiceId of choiceIds) {
        const count = row[choiceId];
        if (count === undefined) throw new BallotDecryptError(`ballot ${index}: choice not in manifest`);
        row[choiceId] = count + 1;
      }
    }
  });

  return totals;
}

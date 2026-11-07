// AC1: sealed-box encrypt; a 1-byte tamper fails decrypt.
import { beforeAll, describe, expect, it } from "vitest";
import { aggregateDecrypt, encryptBallot, generateElectionKeyPair, ready } from "./index.js";
import { ballotA, ballotB, flipByte, manifest } from "./fixtures.test-helpers.js";
import { BALLOT_PAD_BLOCK } from "./sealedBallot.js";
import { BallotDecryptError, openSealedBallot } from "./internal/decrypt.js";
import { getSodium } from "./ready.js";

let keys: { publicKey: Uint8Array; secretKey: Uint8Array };

beforeAll(async () => {
  await ready();
  keys = await generateElectionKeyPair();
});

describe("encryptBallot (AC1)", () => {
  it("produces an X25519 keypair of the right sizes", () => {
    expect(keys.publicKey).toHaveLength(32);
    expect(keys.secretKey).toHaveLength(32);
  });

  it("round-trips through the internal decrypt", async () => {
    const sodium = await getSodium();
    const ct = await encryptBallot(ballotA, keys.publicKey);
    expect(openSealedBallot(sodium, ct, keys.publicKey, keys.secretKey)).toEqual(ballotA);
  });

  it("is randomised: the same ballot encrypts differently each time", async () => {
    const a = await encryptBallot(ballotA, keys.publicKey);
    const b = await encryptBallot(ballotA, keys.publicKey);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("pads so ciphertext length does not depend on which choices were made", async () => {
    const a = await encryptBallot(ballotA, keys.publicKey);
    const b = await encryptBallot(ballotB, keys.publicKey);
    expect(a.length).toBe(b.length);
    expect((a.length - 48) % BALLOT_PAD_BLOCK).toBe(0); // 48 = crypto_box_SEALBYTES
  });

  it("fails to open after flipping any single byte (internal decrypt)", async () => {
    const sodium = await getSodium();
    const ct = await encryptBallot(ballotA, keys.publicKey);
    for (const index of [0, 31, 32, 47, 48, ct.length - 1]) {
      expect(() => openSealedBallot(sodium, flipByte(ct, index), keys.publicKey, keys.secretKey)).toThrow(
        BallotDecryptError,
      );
    }
  });

  it("a 1-byte tamper makes aggregateDecrypt of a single ballot fail", async () => {
    const ct = await encryptBallot(ballotA, keys.publicKey);
    await expect(aggregateDecrypt([flipByte(ct, 60)], keys.secretKey, manifest)).rejects.toThrow(BallotDecryptError);
  });

  it("one tampered box fails the whole aggregate, returning no partial totals", async () => {
    const good = await encryptBallot(ballotA, keys.publicKey);
    const bad = flipByte(await encryptBallot(ballotB, keys.publicKey), 10);
    await expect(aggregateDecrypt([good, bad, good], keys.secretKey, manifest)).rejects.toThrow(/ballot 1/);
  });

  it("a ballot sealed to a different key fails", async () => {
    const other = await generateElectionKeyPair();
    const ct = await encryptBallot(ballotA, other.publicKey);
    await expect(aggregateDecrypt([ct], keys.secretKey, manifest)).rejects.toThrow(BallotDecryptError);
  });

  it("rejects malformed keys and ballots", async () => {
    await expect(encryptBallot(ballotA, new Uint8Array(31))).rejects.toThrow(RangeError);
    await expect(
      encryptBallot({ contests: [{ contestId: "mayor", choiceIds: ["a", "a"] }] }, keys.publicKey),
    ).rejects.toThrow(/more than once/);
    await expect(encryptBallot({} as never, keys.publicKey)).rejects.toThrow(TypeError);
  });
});

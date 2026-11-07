import { expect, test } from "vitest";
import { type CryptoAdapter, DEFAULT_CRYPTO, E3_PENDING, pendingCrypto } from "./crypto-adapter.ts";

// AC5: until E3 merges, every crypto call throws, so no placeholder ciphertext or tracking code exists.
const METHODS: Array<keyof CryptoAdapter> = [
  "generateSigningKeyPair",
  "encryptBallot",
  "computeTrackingCode",
  "isTrackingCode",
  "buildMerkleTree",
  "aggregateDecrypt",
  "signStageRecord",
  "verifyStageRecord",
  "ciphertextHash",
  "eventHash",
];

test("the adapter lists exactly these methods", () => {
  expect(Object.keys(pendingCrypto).sort()).toEqual([...METHODS].sort());
});

test.each(METHODS)("pendingCrypto.%s throws 'crypto lands with E3'", (method) => {
  const call = pendingCrypto[method] as (...args: unknown[]) => unknown;
  expect(() => call()).toThrow("crypto lands with E3");
  expect(() => call()).toThrow(`${E3_PENDING} (${method})`);
});

test("the real CLI's default adapter is pendingCrypto, and it cannot be patched", () => {
  expect(DEFAULT_CRYPTO).toBe(pendingCrypto);
  expect(Object.isFrozen(pendingCrypto)).toBe(true);
});

// AC2: chained tracking codes are deterministic; format frozen as WORD-WORD-XXXX-WORD.
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { computeTrackingCode, encryptBallot, generateElectionKeyPair, TRACKING_WORDLIST } from "./index.js";
import { CROCKFORD_BASE32, TRACKING_CODE_PATTERN } from "./trackingCode.js";
import { ballotA, flipByte } from "./fixtures.test-helpers.js";

/** Independent reference: treat the SHA-256 digest as one 256-bit big-endian integer. */
function referenceCode(ciphertext: Uint8Array, prev: string | null): string {
  const digest = createHash("sha256")
    .update(ciphertext)
    .update(Uint8Array.of(0))
    .update(prev ?? "", "utf8")
    .digest("hex");
  const h = BigInt(`0x${digest}`);
  const bits = (offset: number, count: number) => Number((h >> BigInt(256 - offset - count)) & ((1n << BigInt(count)) - 1n));
  const x = Array.from({ length: 4 }, (_, i) => CROCKFORD_BASE32[bits(22 + i * 5, 5)]).join("");
  return [TRACKING_WORDLIST[bits(0, 11)], TRACKING_WORDLIST[bits(11, 11)], x, TRACKING_WORDLIST[bits(42, 11)]].join("-");
}

const fixed = new Uint8Array(64).map((_, i) => i);

describe("computeTrackingCode (AC2)", () => {
  let ciphertexts: Uint8Array[];

  beforeAll(async () => {
    const { publicKey } = await generateElectionKeyPair();
    ciphertexts = await Promise.all(Array.from({ length: 50 }, () => encryptBallot(ballotA, publicKey)));
  });

  it("matches pinned vectors (format and derivation are frozen)", () => {
    const first = computeTrackingCode(fixed, null);
    expect(first).toBe("FIX-IGNORE-0WXP-PRICE");
    expect(computeTrackingCode(fixed, first)).toBe("BASIC-SURVEY-VQST-RABBIT");
    expect(computeTrackingCode(new Uint8Array(0), null)).toBe("HOTEL-PARK-WWZY-SOCIAL");
  });

  it("matches an independent big-endian bit-packing implementation", () => {
    let prev: string | null = null;
    for (const ct of ciphertexts) {
      const code = computeTrackingCode(ct, prev);
      expect(code).toBe(referenceCode(ct, prev));
      prev = code;
    }
  });

  it("always has the shape WORD-WORD-XXXX-WORD with wordlist words and Crockford Base32", () => {
    let prev: string | null = null;
    for (const ct of ciphertexts) {
      const code = computeTrackingCode(ct, prev);
      expect(code).toMatch(TRACKING_CODE_PATTERN);
      const [w0, w1, x, w2] = code.split("-") as [string, string, string, string];
      for (const w of [w0, w1, w2]) expect(TRACKING_WORDLIST).toContain(w);
      expect(x).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(x).not.toMatch(/[ILOU]/);
      prev = code;
    }
    expect("RIVER-MAPLE-7Q4K-HAWK").toMatch(TRACKING_CODE_PATTERN);
  });

  it("is deterministic and chains: the same chain recomputes identically", () => {
    const chain = (cts: Uint8Array[]) => {
      const codes: string[] = [];
      for (const ct of cts) codes.push(computeTrackingCode(ct, codes.at(-1) ?? null));
      return codes;
    };
    const a = chain(ciphertexts);
    expect(chain(ciphertexts)).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
  });

  it("changes when the ciphertext or the previous code changes", () => {
    const base = computeTrackingCode(fixed, "RIVER-MAPLE-7Q4K-HAWK");
    expect(computeTrackingCode(flipByte(fixed, 0), "RIVER-MAPLE-7Q4K-HAWK")).not.toBe(base);
    expect(computeTrackingCode(fixed, "RIVER-MAPLE-7Q4K-HAWX")).not.toBe(base);
    expect(computeTrackingCode(fixed, null)).not.toBe(base);
  });

  it("treats null and empty-string previous codes the same (both start a chain)", () => {
    expect(computeTrackingCode(fixed, "")).toBe(computeTrackingCode(fixed, null));
  });

  it("rejects non-byte input", () => {
    expect(() => computeTrackingCode("abc" as never, null)).toThrow(TypeError);
    expect(() => computeTrackingCode(fixed, 5 as never)).toThrow(TypeError);
  });
});

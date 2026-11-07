import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TRACKING_WORDLIST } from "./index.js";

describe("TRACKING_WORDLIST", () => {
  it("has exactly 2048 distinct uppercase words", () => {
    expect(TRACKING_WORDLIST).toHaveLength(2048);
    expect(new Set(TRACKING_WORDLIST).size).toBe(2048);
    for (const word of TRACKING_WORDLIST) expect(word).toMatch(/^[A-Z]{3,8}$/);
  });

  it("is frozen: contents and order match the pinned fingerprint", () => {
    const fingerprint = createHash("sha256").update(TRACKING_WORDLIST.join("\n")).digest("hex");
    expect(fingerprint).toBe("ffba1d4e921acb7f2a8986704b874de5957d9b5455b40a09630359cb2c4e02ff");
    expect(Object.isFrozen(TRACKING_WORDLIST)).toBe(true);
  });

  it("contains the words in the receipt example", () => {
    for (const word of ["RIVER", "MAPLE", "HAWK"]) expect(TRACKING_WORDLIST).toContain(word);
  });
});

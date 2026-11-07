import { describe, expect, test } from "vitest";
import { isWellFormedCode, MAX_CODE_LENGTH, normaliseCode } from "./code";

describe("normaliseCode", () => {
  test.each([
    ["seed-0001", "SEED-0001"],
    ["  SEED-0001\n", "SEED-0001"],
    ["river maple 7q4k hawk", "RIVER-MAPLE-7Q4K-HAWK"],
    ["river   maple\t7q4k  hawk", "RIVER-MAPLE-7Q4K-HAWK"],
  ])("%j → %j", (raw, expected) => {
    expect(normaliseCode(raw)).toBe(expected);
    expect(isWellFormedCode(normaliseCode(raw))).toBe(true);
  });

  test("a huge input normalises to nothing rather than being processed", () => {
    expect(normaliseCode("A".repeat(10_000))).toBe("");
  });
});

describe("isWellFormedCode", () => {
  test.each(["SEED-0001", "RIVER-MAPLE-7Q4K-HAWK", "A", "ABCDEFGHIJKL"])("accepts %s", (code) => {
    expect(isWellFormedCode(code)).toBe(true);
  });

  test.each([
    ["empty", ""],
    ["PostgREST comma", "SEED-0001,SEED-0002"],
    ["PostgREST parens", "SEED(0001)"],
    ["PostgREST star", "SEED*"],
    ["PostgREST dot operator", "eq.SEED-0001"],
    ["quote", 'SEED"0001'],
    ["ampersand", "SEED&select=ciphertext"],
    ["percent", "SEED%2C0001"],
    ["lower case (not normalised)", "seed-0001"],
    ["leading dash", "-SEED"],
    ["double dash", "SEED--0001"],
    ["group over 12", "ABCDEFGHIJKLM"],
    ["more than 8 groups", "A-B-C-D-E-F-G-H-I"],
  ])("rejects %s", (_name, code) => {
    expect(isWellFormedCode(code)).toBe(false);
  });

  test(`rejects anything over ${MAX_CODE_LENGTH} characters even when the groups are valid`, () => {
    const long = Array.from({ length: 8 }, () => "ABCDEFGHIJKL").join("-");
    expect(long.length).toBeGreaterThan(MAX_CODE_LENGTH);
    expect(isWellFormedCode(long)).toBe(false);
  });
});

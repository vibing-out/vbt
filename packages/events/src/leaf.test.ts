import { expect, test } from "vitest";
import { sha256Hex } from "./hash.ts";
import { sortStageLeaves, stageLeaf, stageLeaves } from "./leaf.ts";

// Inclusion proofs over these leaves (AC2, AC3) are tested with @vbt/crypto's tree in
// apps/web/lib/batches.test.ts, so this package stays free of @vbt/crypto and its build step.

const ballots = Array.from({ length: 25 }, (_, i) => ({
  tracking_code: `CODE-${String(i).padStart(3, "0")}`,
  ciphertext_hash: sha256Hex(`ciphertext-${i}`),
}));

test("C17: leaf = UTF-8(tracking_code) || 0x00 || 32 hash bytes", () => {
  const hash = "ab".repeat(32);
  const leaf = stageLeaf("RIVER-MAPLE-7Q4K-HAWK", hash);
  const code = new TextEncoder().encode("RIVER-MAPLE-7Q4K-HAWK");
  expect(leaf.length).toBe(code.length + 1 + 32);
  expect([...leaf.slice(0, code.length)]).toEqual([...code]);
  expect(leaf[code.length]).toBe(0);
  expect([...leaf.slice(code.length + 1)]).toEqual(Array(32).fill(0xab));
});

test.each([
  ["", "ab".repeat(32)],
  ["A\u0000B", "ab".repeat(32)],
  ["CODE", "AB".repeat(32)],
  ["CODE", "ab".repeat(31)],
])("stageLeaf refuses code %j / hash %j", (code, hash) => {
  expect(() => stageLeaf(code, hash)).toThrow(TypeError);
});

test("AC2: leaf order depends only on ciphertext_hash (then tracking_code), never on input order", () => {
  const sorted = sortStageLeaves(ballots);
  const hashes = sorted.map((b) => b.ciphertext_hash);
  expect(hashes).toEqual([...hashes].sort());
  const reversed = sortStageLeaves([...ballots].reverse());
  expect(reversed).toEqual(sorted);
  const shuffled = sortStageLeaves([...ballots.slice(13), ...ballots.slice(0, 13)]);
  expect(shuffled).toEqual(sorted);
  // Ties on the hash fall back to the tracking code.
  const tie = sortStageLeaves([
    { tracking_code: "B", ciphertext_hash: "0".repeat(64) },
    { tracking_code: "A", ciphertext_hash: "0".repeat(64) },
  ]);
  expect(tie.map((b) => b.tracking_code)).toEqual(["A", "B"]);
  // The input is not mutated.
  expect(ballots[0]!.tracking_code).toBe("CODE-000");
});

test("stageLeaves is the sorted ballots' leaves", () => {
  const expected = sortStageLeaves(ballots).map((b) => stageLeaf(b.tracking_code, b.ciphertext_hash));
  expect(stageLeaves([...ballots].reverse())).toEqual(expected);
});

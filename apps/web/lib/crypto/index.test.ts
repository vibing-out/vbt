import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { bytesToBase64, bytesToHex, ciphertextBytes, CRYPTO_UNAVAILABLE, CryptoKeysMissingError, CryptoUnavailableError, getCrypto, hexToBytes, keys, toTotals } from "./index";

// AC1b (T-09): until E3 is on main the adapter publishes nothing. Every member fails with the one message,
// and nothing returns a placeholder root, signature or totals.
describe("the production adapter before E3 lands", () => {
  const crypto = getCrypto();
  const bytes = new Uint8Array(32);
  const record = { scope: "precinct:18097-001", stage: "TALLIED_PRECINCT", merkleRoot: "0".repeat(64), ballotCount: 0, totals: {} };

  test.each([
    ["ready", () => crypto.ready()],
    ["signStageRecord", () => crypto.signStageRecord(record, bytes)],
    ["verifyStageRecord", () => crypto.verifyStageRecord(record, bytes, bytes)],
    ["aggregateDecrypt", () => crypto.aggregateDecrypt([bytes], bytes, { contests: [] })],
  ])("%s rejects with 'stage records publish once E3 lands'", async (_name, call) => {
    await expect(call()).rejects.toThrow(new CryptoUnavailableError());
    await expect(call()).rejects.toThrow(CRYPTO_UNAVAILABLE);
  });

  test.each([
    ["buildMerkleTree", () => crypto.buildMerkleTree([bytes])],
    ["verifyInclusionProof", () => crypto.verifyInclusionProof(bytes, { steps: [] }, bytes)],
  ])("%s throws with the same message", (_name, call) => {
    expect(call).toThrow(CRYPTO_UNAVAILABLE);
  });

  test("the message is exactly the approved one", () => {
    expect(CRYPTO_UNAVAILABLE).toBe("stage records publish once E3 lands");
  });
});

describe("keys and encodings", () => {
  test("keys() reads the three base64 keys and fails closed when one is missing or malformed", () => {
    const env = { ELECTION_SECRET_KEY: "AAEC", STAGE_SIGNING_SECRET_KEY: "AwQF", STAGE_SIGNING_PUBLIC_KEY: "BgcI" };
    expect([...keys(env).electionSecretKey]).toEqual([0, 1, 2]);
    expect([...keys(env).signingPublicKey]).toEqual([6, 7, 8]);
    expect(() => keys({ ...env, STAGE_SIGNING_SECRET_KEY: "" })).toThrow(CryptoKeysMissingError);
    expect(() => keys({ ...env, ELECTION_SECRET_KEY: "not base64!" })).toThrow(CryptoKeysMissingError);
    expect(() => keys({})).toThrow(CryptoKeysMissingError);
  });

  test("hex, base64 and totals helpers", () => {
    expect(bytesToHex(hexToBytes("00ff10"))).toBe("00ff10");
    expect(() => hexToBytes("0F")).toThrow(TypeError);
    expect(() => hexToBytes("abc")).toThrow(TypeError);
    expect(bytesToBase64(new Uint8Array([1, 2, 3]))).toBe("AQID");
    expect([...ciphertextBytes("AQID")]).toEqual([1, 2, 3]);
    expect(toTotals({ c: { s: 1 } }, 1)).toEqual({ ballotCount: 1, contests: { c: { s: 1 } } });
  });
});

const WEB = join(import.meta.dirname, "..", "..");
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if ([".next", "node_modules"].includes(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

test("only tests and lib/testing import the fake crypto", () => {
  const importers = sourceFiles(WEB)
    .filter((file) => /fake-crypto/.test(readFileSync(file, "utf8")))
    .map((file) => relative(WEB, file))
    .filter((file) => !/\.test\.tsx?$/.test(file) && !file.startsWith(join("lib", "testing")) && file !== join("lib", "crypto", "index.test.ts"));
  expect(importers).toEqual([]);
});

test("only the adapter reads the election and stage-signing keys", () => {
  const readers = sourceFiles(WEB)
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .filter((file) => /(ELECTION_SECRET_KEY|STAGE_SIGNING_(SECRET|PUBLIC)_KEY)/.test(readFileSync(file, "utf8")))
    .map((file) => relative(WEB, file));
  // T-05's lib/election.ts (E3) also loads the keys for POST /api/batches; collapsing the two readers
  // into one is a follow-up after E3 and E4 are both on main.
  expect(readers.sort()).toEqual(
    [join("lib", "crypto", "index.ts"), join("lib", "election.ts"), join("lib", "testing", "election-fixtures.ts")].sort(),
  );
});

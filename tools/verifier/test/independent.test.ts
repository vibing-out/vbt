// AC 2 (T-15a): an independent check written only from docs/record-format.md, without
// packages/crypto, agrees with tools/verifier on a seeded record, and both fail when one ciphertext
// hash or one stage total is altered.

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import type { PublishedRecord } from "../src/record.ts";
import { checkInclusion, type CountyRecords, verifyCounty } from "../src/verify.ts";
import { seededElection, type SeededElection } from "./fixtures/seeded-election.ts";
import * as independent from "./independent/check.ts";

let election: SeededElection;
beforeAll(async () => {
  election = await seededElection();
});

const clone = <T>(v: T): T => structuredClone(v);

function county(e: SeededElection, withChallenge = true): CountyRecords & independent.County {
  return {
    precincts: e.precincts,
    unofficial: e.unofficial,
    certified: e.certified,
    challenged: withChallenge ? e.challenged : null,
    discarded: null,
  };
}

/** Both verifiers over the same county, as comparable verdicts. */
async function runBoth(c: CountyRecords & independent.County, key: Uint8Array) {
  const ours = await verifyCounty(c, key);
  return {
    ours: ours.checks.map(({ check, scope_id, stage, ok }) => ({ check, scope_id, stage, ok })),
    oursOk: ours.ok,
    theirs: independent.verifyCounty(c, key),
  };
}

const failed = (verdicts: { check: string; scope_id: string; stage: string; ok: boolean }[]) =>
  verdicts.filter((v) => !v.ok).map((v) => `${v.check} ${v.scope_id}/${v.stage}`);

/** Re-lists a tampered record in leaf order (ciphertext_hash, then tracking_code), so only the root can catch it. */
function resort(r: PublishedRecord): void {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  r.ballots.sort((x, y) => cmp(x.ciphertext_hash, y.ciphertext_hash) || cmp(x.tracking_code, y.tracking_code));
}

/** Flips the first hex digit, so the value stays well-formed but is no longer the same hash. */
const flip = (hash: string) => (hash[0] === "0" ? "1" : "0") + hash.slice(1);

describe("the independent check is independent", () => {
  test("imports only node:crypto: no @vbt package, no packages/, no tools/verifier/src", () => {
    const source = readFileSync(new URL("./independent/check.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gms)].map((m) => m[1]);
    expect(imports).toEqual(["node:crypto"]);
    const code = source.replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/@vbt\/|packages\/|\.\.\/\.\.\/src|require\(|import\(/);
  });
});

describe("on the seeded record", () => {
  test("seeds a county with precinct, unofficial, certified and challenged records", () => {
    expect(election.precincts).toHaveLength(3);
    expect(election.precincts.every((p) => p.scope === "precinct" && p.stage === "TALLIED_PRECINCT")).toBe(true);
    // 61 ballots at 5% → 3 mismatched, kept out of the precinct records (T-11 decision #293).
    expect(election.unofficial.ballot_count).toBe(58);
    expect(election.certified.ballot_count).toBe(57);
    expect(election.challenged.ballot_count).toBe(1);
  });

  test("both pass every check and give the same verdict for each", async () => {
    const { ours, oursOk, theirs } = await runBoth(county(election), election.publicKey);
    expect(oursOk).toBe(true);
    expect(theirs.every((v) => v.ok)).toBe(true);
    expect(theirs).toEqual(ours);
    // 6 records × 4 checks, C2 on 3 precincts, C3 and C4.
    expect(ours).toHaveLength(6 * 4 + 3 + 2);
  });

  test("the independent root is byte-for-byte the published root of every record", () => {
    for (const r of [...election.precincts, election.unofficial, election.certified, election.challenged]) {
      expect(independent.merkleRoot(r.ballots)).toBe(r.merkle_root);
    }
  });

  test("both accept every receipt's inclusion proof", () => {
    for (const { record, code, ciphertext_hash, proof } of election.receipts) {
      expect(checkInclusion(record, code, ciphertext_hash, proof).ok).toBe(true);
      expect(independent.inclusion(record, code, ciphertext_hash, proof).ok).toBe(true);
    }
  });

  test("both accept the signature as 128 hex characters too (record-format §6.3)", async () => {
    const e = clone(election);
    for (const r of [...e.precincts, e.unofficial, e.certified, e.challenged]) {
      r.signature = Buffer.from(r.signature, "base64").toString("hex");
    }
    const { oursOk, theirs } = await runBoth(county(e), e.publicKey);
    expect(oursOk).toBe(true);
    expect(theirs.every((v) => v.ok)).toBe(true);
  });
});

describe("one altered ciphertext hash", () => {
  test("in a precinct record: both fail its Merkle root and C3, and agree on every check", async () => {
    const e = clone(election);
    const p = e.precincts[1] as PublishedRecord;
    const b = p.ballots[2] as PublishedRecord["ballots"][number];
    b.ciphertext_hash = flip(b.ciphertext_hash);
    resort(p);

    const { ours, oursOk, theirs } = await runBoth(county(e), e.publicKey);
    expect(oursOk).toBe(false);
    expect(theirs).toEqual(ours);
    expect(failed(ours)).toEqual([`merkle-root ${p.scope_id}/TALLIED_PRECINCT`, "c3 SCALE-DEMO/REPORTED_UNOFFICIAL"]);
  });

  test("in the certified record: both fail its Merkle root and C4", async () => {
    const e = clone(election);
    const b = e.certified.ballots[10] as PublishedRecord["ballots"][number];
    b.ciphertext_hash = flip(b.ciphertext_hash);
    resort(e.certified);

    const { ours, oursOk, theirs } = await runBoth(county(e), e.publicKey);
    expect(oursOk).toBe(false);
    expect(theirs).toEqual(ours);
    expect(failed(ours)).toEqual(["merkle-root SCALE-DEMO/CERTIFIED", "c4 SCALE-DEMO/CERTIFIED"]);
  });

  test("on a receipt: both reject its inclusion proof", () => {
    for (const { record, code, ciphertext_hash, proof } of election.receipts) {
      expect(checkInclusion(record, code, flip(ciphertext_hash), proof).ok).toBe(false);
      expect(independent.inclusion(record, code, flip(ciphertext_hash), proof).ok).toBe(false);
    }
  });
});

describe("one altered stage total", () => {
  test("in a precinct record: both fail its signature and C3, and agree on every check", async () => {
    const e = clone(election);
    const p = e.precincts[0] as PublishedRecord;
    const [contest, row] = Object.entries(p.totals)[0] as [string, Record<string, number>];
    const choice = Object.keys(row)[0] as string;
    (p.totals[contest] as Record<string, number>)[choice] = (row[choice] as number) + 1;

    const { ours, oursOk, theirs } = await runBoth(county(e), e.publicKey);
    expect(oursOk).toBe(false);
    expect(theirs).toEqual(ours);
    expect(failed(ours)).toEqual([`signature ${p.scope_id}/TALLIED_PRECINCT`, "c3 SCALE-DEMO/REPORTED_UNOFFICIAL"]);
  });

  test("in the certified record: both fail its signature", async () => {
    const e = clone(election);
    // Add one vote back to the choice the dropped ballot took one from, so C4's bounds still hold
    // and only the signature can catch the change.
    const row = e.certified.totals.governor as Record<string, number>;
    const choice = Object.keys(row).find((k) => (row[k] as number) < (e.unofficial.totals.governor?.[k] as number)) as string;
    row[choice] = (row[choice] as number) + 1;

    const { ours, oursOk, theirs } = await runBoth(county(e), e.publicKey);
    expect(oursOk).toBe(false);
    expect(theirs).toEqual(ours);
    expect(failed(ours)).toEqual(["signature SCALE-DEMO/CERTIFIED"]);
  });
});

describe("other tampering both catch the same way", () => {
  test("a key that is not the election office's fails every signature", async () => {
    const wrongKey = new Uint8Array(election.publicKey);
    wrongKey[0] = (wrongKey[0] as number) ^ 0xff;
    const { ours, theirs } = await runBoth(county(election), wrongKey);
    expect(theirs).toEqual(ours);
    expect(failed(ours).every((f) => f.startsWith("signature "))).toBe(true);
    expect(failed(ours)).toHaveLength(6);
  });

  test("ballots listed out of leaf order fail leaf-order but keep the root", async () => {
    const e = clone(election);
    const p = e.precincts[2] as PublishedRecord;
    p.ballots.reverse();
    const { ours, theirs } = await runBoth(county(e), e.publicKey);
    expect(theirs).toEqual(ours);
    expect(failed(ours)).toEqual([`leaf-order ${p.scope_id}/TALLIED_PRECINCT`]);
  });

  test("a certified ballot removed with no published challenge fails C4", async () => {
    const { ours, theirs } = await runBoth(county(election, false), election.publicKey);
    expect(theirs).toEqual(ours);
    expect(failed(ours)).toEqual(["c4 SCALE-DEMO/CERTIFIED"]);
  });

  test("a tracking code swapped onto another ballot's hash breaks the root (the leaf binds code to hash)", async () => {
    const e = clone(election);
    const p = e.precincts[0] as PublishedRecord;
    const [a, b] = p.ballots as [PublishedRecord["ballots"][number], PublishedRecord["ballots"][number]];
    [a.tracking_code, b.tracking_code] = [b.tracking_code, a.tracking_code];
    const { ours, theirs } = await runBoth(county(e), e.publicKey);
    expect(theirs).toEqual(ours);
    expect(failed(ours)).toContain(`merkle-root ${p.scope_id}/TALLIED_PRECINCT`);
  });
});

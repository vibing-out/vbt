// AC5: aggregateDecrypt returns contest/choice totals only; no public individual plaintext API.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import * as publicApi from "./index.js";
import { aggregateDecrypt, encryptBallot, generateElectionKeyPair } from "./index.js";
import { ballotA, ballotB, ballotC, manifest } from "./fixtures.test-helpers.js";

let keys: { publicKey: Uint8Array; secretKey: Uint8Array };

beforeAll(async () => {
  keys = await generateElectionKeyPair();
});

describe("aggregateDecrypt (AC5)", () => {
  it("returns per-contest, per-choice totals including zero rows", async () => {
    const cts = await Promise.all([ballotA, ballotB, ballotC, ballotA].map((b) => encryptBallot(b, keys.publicKey)));
    const totals = await aggregateDecrypt(cts, keys.secretKey, manifest);
    expect(totals).toEqual({
      mayor: { alvarez: 3, brooks: 0, chen: 1 },
      "measure-a": { yes: 3, no: 0 },
      council: { d: 2, e: 0, f: 3, g: 0 },
    });
  });

  it("returns only numbers keyed by manifest ids: nothing per ballot", async () => {
    const cts = await Promise.all([ballotA, ballotB].map((b) => encryptBallot(b, keys.publicKey)));
    const totals = await aggregateDecrypt(cts, keys.secretKey, manifest);
    expect(Object.keys(totals).sort()).toEqual(["council", "mayor", "measure-a"]);
    for (const row of Object.values(totals)) {
      for (const count of Object.values(row)) expect(typeof count).toBe("number");
    }
  });

  it("returns zeroed totals for no ballots", async () => {
    expect(await aggregateDecrypt([], keys.secretKey, manifest)).toEqual({
      mayor: { alvarez: 0, brooks: 0, chen: 0 },
      "measure-a": { yes: 0, no: 0 },
      council: { d: 0, e: 0, f: 0, g: 0 },
    });
  });

  it("fails the whole call for a ballot naming a contest or choice not in the manifest", async () => {
    const good = await encryptBallot(ballotA, keys.publicKey);
    const badContest = await encryptBallot({ contests: [{ contestId: "sheriff", choiceIds: ["x"] }] }, keys.publicKey);
    const badChoice = await encryptBallot({ contests: [{ contestId: "mayor", choiceIds: ["zed"] }] }, keys.publicKey);
    await expect(aggregateDecrypt([good, badContest], keys.secretKey, manifest)).rejects.toThrow(
      "ballot 1: contest not in manifest",
    );
    await expect(aggregateDecrypt([badChoice], keys.secretKey, manifest)).rejects.toThrow(
      "ballot 0: choice not in manifest",
    );
  });

  it("error messages never contain plaintext choice ids", async () => {
    const ct = await encryptBallot({ contests: [{ contestId: "mayor", choiceIds: ["secret-choice"] }] }, keys.publicKey);
    const error = await aggregateDecrypt([ct], keys.secretKey, manifest).catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toContain("secret-choice");
  });

  it("rejects an invalid manifest or key", async () => {
    await expect(
      aggregateDecrypt([], keys.secretKey, { contests: [{ id: "x", choices: [{ id: "a" }, { id: "a" }] }] }),
    ).rejects.toThrow(/duplicate choice/);
    await expect(aggregateDecrypt([], new Uint8Array(16), manifest)).rejects.toThrow(RangeError);
  });

  it("the public index exports exactly the locked API, with no individual decrypt", () => {
    expect(Object.keys(publicApi).sort()).toEqual(
      [
        "TRACKING_CODE_PATTERN",
        "TRACKING_WORDLIST",
        "aggregateDecrypt",
        "buildMerkleTree",
        "computeTrackingCode",
        "encryptBallot",
        "generateElectionKeyPair",
        "generateSigningKeyPair",
        "isTrackingCode",
        "ready",
        "signStageRecord",
        "verifyInclusionProof",
        "verifyStageRecord",
      ].sort(),
    );
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/internal\//);
    expect(source).not.toMatch(/decryptBallot|openSealedBallot/);
  });

  it("package.json exposes only the built index entry point", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      name: string;
      exports: Record<string, unknown>;
    };
    expect(pkg.name).toBe("@vbt/crypto");
    expect(Object.keys(pkg.exports)).toEqual(["."]);
  });
});

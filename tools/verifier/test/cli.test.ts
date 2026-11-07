// The public CLI surface, the JSON report, unit checks on small records, and
// the guard that all crypto goes through src/crypto.ts.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkChain } from "../src/checks/chain.ts";
import { checkC2, checkC3, checkC4 } from "../src/checks/totals.ts";
import { main } from "../src/cli.ts";
import { CRYPTO_UNAVAILABLE, CryptoUnavailableError, realCrypto } from "../src/crypto.ts";
import { parseRecord } from "../src/record.ts";
import { parseBaseUrl } from "../src/source.ts";
import {
  allRuns,
  buildElection,
  codeFor,
  type Election,
  findRecord,
  leakingLines,
  recordArgs,
  runCli,
  serve,
  type Server,
  trackFor,
} from "./fixtures/build-election.ts";

let e: Election;
let s: Server;

beforeAll(async () => {
  e = buildElection({ ballots: 40, precincts: 2 });
  s = await serve(e);
});

afterAll(async () => {
  await s.close();
});

describe("the public CLI", () => {
  it("--json prints {checks:[{id,scope,stage,status,message}], passed}", async () => {
    const res = await runCli([...recordArgs(s), "--json"]);
    expect(res.code).toBe(0);
    const report = JSON.parse(res.out) as { checks: Record<string, unknown>[]; passed: boolean };
    expect(Object.keys(report).sort()).toEqual(["checks", "passed"]);
    expect(report.passed).toBe(true);
    for (const c of report.checks) expect(Object.keys(c).sort()).toEqual(["id", "message", "scope", "stage", "status"]);
    expect(report.checks).toContainEqual({ id: "c4", scope: e.county, stage: "CERTIFIED", status: "PASS", message: "" });
  });

  it.each([
    ["the old --url flag", ["record", "--url", "https://x.test", "--county", "c", "--precinct", "p"]],
    ["no source", ["record", "--county", "c", "--precinct", "p"]],
    ["both sources", ["record", "--base-url", "https://x.test", "--from-dir", "/tmp", "--county", "c", "--precinct", "p"]],
    ["no --precinct", ["record", "--base-url", "https://x.test", "--county", "c"]],
    ["a hex public key", ["record", "--base-url", "https://x.test", "--county", "c", "--precinct", "p", "--public-key", "ab".repeat(32)]],
    ["download without --out", ["download", "--base-url", "https://x.test", "--county", "c", "--precinct", "p"]],
    ["download with --from-dir", ["download", "--from-dir", "/tmp", "--county", "c", "--precinct", "p", "--out", "/tmp/x"]],
    ["code without a code", ["code", "--base-url", "https://x.test"]],
    ["code with --county", ["code", codeFor(1), "--base-url", "https://x.test", "--county", "c"]],
    ["an unknown command", ["verify"]],
  ])("%s is a usage error (exit 2)", async (_name, argv) => {
    const res = await runCli(argv);
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/^ERROR usage: /);
  });

  it("--help prints the usage with the spec's command forms", async () => {
    const res = await runCli(["--help"]);
    expect(res.code).toBe(0);
    expect(res.out).toContain("vbt-verify record   --base-url <url> --county <id> --precinct <id>... [--public-key <b64>] [--json]");
    expect(res.out).toContain("vbt-verify code     <tracking-code> --base-url <url> [--public-key <b64>] [--json]");
    expect(res.out).toContain("vbt-verify download --base-url <url> --county <id> --precinct <id>... --out <dir>");
    expect(res.out).toContain("vbt-verify record|code ... --from-dir <dir>");
  });

  it("requires https except on localhost and 127.0.0.1", () => {
    expect(() => parseBaseUrl("http://www.ballottrack.org")).toThrow(/must use https/);
    expect(parseBaseUrl("http://127.0.0.1:3000").toString()).toBe("http://127.0.0.1:3000/");
    expect(parseBaseUrl("https://www.ballottrack.org").toString()).toBe("https://www.ballottrack.org/");
  });

  it("an unknown tracking code exits 2", async () => {
    const res = await runCli(["code", codeFor(999), "--base-url", s.url, "--public-key", e.publicKey]);
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/^ERROR \S+\/api\/track\/\S+: no ballot has this tracking code$/m);
  });

  it("an unpublished stage in a code lookup skips that inclusion check", async () => {
    const code = codeFor(10);
    const track = trackFor(e, code);
    track.proofs.push({ scope_id: "18097-999", stage: "TALLIED_PRECINCT", path: [] });
    s.tracks.set(code, track);
    const res = await runCli(["code", code, "--base-url", s.url, "--public-key", e.publicKey]);
    expect(res.code).toBe(0);
    expect(res.out).toContain("SKIP 18097-999/TALLIED_PRECINCT: not published");
    expect(res.out).toContain(`SKIP inclusion ${code} TALLIED_PRECINCT: needs 18097-999/TALLIED_PRECINCT, not published`);
  });
});

describe("crypto goes only through src/crypto.ts", () => {
  it("until E3, the real adapter throws and the CLI exits 2 with the E3 message", async () => {
    await expect(realCrypto.ready()).rejects.toBeInstanceOf(CryptoUnavailableError);
    expect(() => realCrypto.buildMerkleTree([])).toThrow(CRYPTO_UNAVAILABLE);
    expect(() => realCrypto.verifyInclusionProof(new Uint8Array(), { steps: [] }, new Uint8Array())).toThrow(CRYPTO_UNAVAILABLE);
    expect(() => realCrypto.isTrackingCode("x")).toThrow(CRYPTO_UNAVAILABLE);
    await expect(realCrypto.verifyStageRecord({} as never, new Uint8Array(), new Uint8Array())).rejects.toThrow(CRYPTO_UNAVAILABLE);
    let err = "";
    const code = await main(recordArgs(s), { env: {}, out: () => {}, err: (t) => (err += t) });
    expect(code).toBe(2);
    expect(err).toBe(`ERROR crypto: ${CRYPTO_UNAVAILABLE}\n`);
  });

  it("no source file hashes, signs or imports the test double", async () => {
    const src = join(import.meta.dirname, "..", "src");
    const files = (await readdir(src, { recursive: true })).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const file of files) {
      const text = await readFile(join(src, file), "utf8");
      expect(text, file).not.toMatch(/from "node:crypto"|from "crypto"|createHash|libsodium|subtle\./);
      expect(text, file).not.toMatch(/fake-crypto|\/test\//);
    }
  });
});

describe("checks on small records", () => {
  const record = (over: Partial<ReturnType<typeof parseRecord>>) => ({ ...findRecord(e, e.precincts[0] as string, "TALLIED_PRECINCT"), ...over });

  it("C2 flags a negative or fractional total and a contest with more votes than ballots", () => {
    const r = record({ ballot_count: 3, totals: { a: { x: 2, y: 2 }, b: { x: -1, y: 1.5 } } });
    expect(checkC2(r).map((c) => c.message)).toEqual([
      "total b/x is not a non-negative integer",
      "total b/y is not a non-negative integer",
      "contest a has 4 votes for 3 ballots",
    ]);
  });

  it("C3 flags a ballot_count that is not the sum and a differing ballot set", () => {
    const p = record({});
    const county = { ...findRecord(e, e.county, "REPORTED_UNOFFICIAL") };
    const messages = checkC3([p], county).map((c) => c.message);
    expect(messages).toContain(`ballot_count ${county.ballot_count} != sum of precinct ballot counts ${p.ballot_count}`);
    expect(messages).toContain(`ballot set differs from its precincts by ${county.ballot_count - p.ballot_count} codes`);
  });

  it("C4 flags added ballots and a contest that lost more votes than ballots removed", () => {
    const u = findRecord(e, e.county, "REPORTED_UNOFFICIAL");
    const c = { ...u, stage: "CERTIFIED" as const, totals: { "contest-measure-1": { yes: 0, no: 0 } } };
    const extra = { ...c, ballots: [...c.ballots, { tracking_code: codeFor(9999), ciphertext_hash: "0".repeat(64) }] };
    const messages = checkC4(u, extra, null, null).map((x) => x.message);
    expect(messages).toContain("1 certified ballots are not in the unofficial record");
    expect(messages.some((m) => /^contest contest-measure-1 lost \d+ votes but only 0 ballots were removed$/.test(m))).toBe(true);
  });

  it("chain reports every broken link", () => {
    const t = trackFor(e, codeFor(3));
    t.events[0] = { ...(t.events[0] as (typeof t.events)[number]), event_type: "STATUS_CHANGE" };
    expect(checkChain("C", t).map((c) => c.message)).toEqual(["first event is not CAST with a null prev_hash"]);
  });

  it("the record guard names the field, never its position", () => {
    const body = structuredClone(findRecord(e, e.county, "CERTIFIED")) as unknown as { ballots: { ciphertext_hash: string }[] };
    (body.ballots[5] as { ciphertext_hash: string }).ciphertext_hash = "XYZ";
    expect(() => parseRecord(body)).toThrow("ballots.ciphertext_hash missing or wrong type");
  });
});

describe("AC10 for this file", () => {
  it("no output line shows a time, a leaf index or a ciphertext", () => {
    expect(allRuns.length).toBeGreaterThan(10);
    expect(leakingLines(allRuns, e)).toEqual([]);
  });
});


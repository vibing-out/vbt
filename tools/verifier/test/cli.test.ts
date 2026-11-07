import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { decodeKey, main } from "../src/cli.ts";
import { FormatError, parseRecord } from "../src/record.ts";
import { seededElection, type SeededElection } from "./fixtures/seeded-election.ts";

let election: SeededElection;
let dir: string;
let files: string[];
let key: string;

beforeAll(async () => {
  election = await seededElection();
  key = Buffer.from(election.publicKey).toString("base64");
  dir = await mkdtemp(join(tmpdir(), "vbt-verify-"));
  const records = [...election.precincts, election.unofficial, election.certified, election.challenged];
  files = [];
  for (const r of records) {
    const file = join(dir, `${r.scope_id}-${r.stage}.json`);
    await writeFile(file, JSON.stringify(r));
    files.push(file);
  }
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function run(argv: string[], env: Record<string, string | undefined> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env });
  return { code, out, err };
}

describe("vbt-verify", () => {
  test("exits 0 on the seeded county and prints one PASS line per check", async () => {
    const { code, out } = await run(["--public-key", key, ...files]);
    expect(code).toBe(0);
    expect(out.at(-1)).toBe("29/29 checks passed");
    expect(out.filter((l) => l.startsWith("PASS "))).toHaveLength(29);
  });

  test("takes the key from STAGE_SIGNING_PUBLIC_KEY and prints JSON with --json", async () => {
    const { code, out } = await run(["--json", ...files], { STAGE_SIGNING_PUBLIC_KEY: key });
    expect(code).toBe(0);
    const body = JSON.parse(out[0] as string) as { passed: boolean; checks: unknown[] };
    expect(body.passed).toBe(true);
    expect(body.checks).toHaveLength(29);
  });

  test("exits 1 with no key: every signature fails, there is no unsigned pass", async () => {
    const { code, out } = await run(files);
    expect(code).toBe(1);
    expect(out.filter((l) => l.startsWith("FAIL signature"))).toHaveLength(6);
  });

  test("exits 1 and names the record when a total is altered", async () => {
    const tampered = structuredClone(election.precincts[0]!);
    tampered.totals.governor!["gov-a"]! += 1;
    const file = join(dir, "tampered.json");
    await writeFile(file, JSON.stringify(tampered));
    const { code, out } = await run(["--public-key", key, file, ...files.slice(1)]);
    expect(code).toBe(1);
    expect(out).toContain(`FAIL signature ${tampered.scope_id}/TALLIED_PRECINCT: signature does not match the stage signing key`);
  });

  test("exits 2 on usage, key and format errors", async () => {
    expect((await run([])).code).toBe(2);
    expect((await run(["--nope", ...files])).code).toBe(2);
    expect((await run(["--public-key", "AAAA", ...files])).code).toBe(2);
    const bad = join(dir, "bad.json");
    await writeFile(bad, JSON.stringify({ ...election.unofficial, merkle_root: "XYZ" }));
    const r = await run(["--public-key", key, bad]);
    expect(r.code).toBe(2);
    expect(r.err[0]).toContain("merkle_root missing or wrong type");
  });

  test("refuses records from two counties", async () => {
    const other = join(dir, "other-county.json");
    await writeFile(other, JSON.stringify({ ...election.certified, scope_id: "OTHER" }));
    const r = await run(["--public-key", key, files[3] as string, other]);
    expect(r.code).toBe(2);
    expect(r.err[0]).toBe("ERROR county records name more than one county");
  });
});

describe("parseRecord", () => {
  test("rejects a scope that does not match the stage, a NUL in a code, and a malformed signature", () => {
    const r = election.precincts[0]!;
    expect(() => parseRecord({ ...r, scope: "county" })).toThrow(FormatError);
    expect(() => parseRecord({ ...r, ballots: [{ tracking_code: "A\u0000B", ciphertext_hash: "0".repeat(64) }] })).toThrow(FormatError);
    expect(() => parseRecord({ ...r, signature: "not base64!" })).toThrow(FormatError);
    expect(parseRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  test("decodeKey takes 32 bytes of base64 only", () => {
    expect(decodeKey(undefined)).toBeNull();
    expect(decodeKey(Buffer.alloc(32, 1).toString("base64"))).toHaveLength(32);
    expect(decodeKey(Buffer.alloc(31).toString("base64"))).toBe("invalid");
  });
});

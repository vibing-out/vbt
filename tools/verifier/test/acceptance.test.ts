// T-15 acceptance criteria AC1 to AC10, end to end through the CLI against a
// local http.createServer fake of the public API, on a signed 10,000-ballot
// election (one county, four precincts, every county stage, one discard and
// two challenges).

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NO_KEY_MESSAGE } from "../src/checks/signature.ts";
import { bytesToHex } from "../src/record.ts";
import {
  allRuns,
  buildElection,
  ciphertextHash,
  clone,
  codeFor,
  type Election,
  findRecord,
  leakingLines,
  rebuildAndSign,
  recordArgs,
  runCli,
  scopeArgs,
  serve,
  type Server,
  sign,
  trackFor,
} from "./fixtures/build-election.ts";
import { sha256, throwawaySigner } from "./fixtures/fake-crypto.ts";

let base: Election;
const servers: Server[] = [];
/** Strings a test altered that output must never show (positions of altered ballots), for AC10. */
const forbidden: string[] = [];

async function serveCopy(edit: (e: Election) => void = () => {}): Promise<Server> {
  const e = clone(base);
  edit(e);
  const s = await serve(e);
  servers.push(s);
  return s;
}

const lines = (text: string) => text.trimEnd().split("\n");
const P1 = () => base.precincts[0] as string;
const P2 = () => base.precincts[1] as string;

beforeAll(() => {
  base = buildElection({ ballots: 10_000, precincts: 4 });
});

afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

describe("AC1: the 10,000-ballot election verifies", () => {
  it("record exits 0 and every check is PASS, in under 60 s", async () => {
    const started = performance.now();
    const s = await serveCopy();
    const res = await runCli(recordArgs(s));
    expect(res.err).toBe("");
    expect(res.code).toBe(0);
    const out = lines(res.out);
    const summary = out.pop();
    expect(summary).toMatch(/^PASSED: \d+ passed, 0 failed, 0 skipped$/);
    for (const line of out) expect(line).toMatch(/^PASS /);
    for (const r of base.records) {
      for (const id of ["signature", "merkle-root", "leaf-order", "ballot-count"]) {
        expect(out).toContain(`PASS ${id} ${r.scope_id}/${r.stage}`);
      }
    }
    for (const p of base.precincts) expect(out).toContain(`PASS C2 ${p}`);
    expect(out).toContain(`PASS C3 ${base.county}`);
    expect(out).toContain(`PASS C4 ${base.county}`);
    expect(performance.now() - started).toBeLessThan(60_000);
  });
});

describe("AC2: altering one ciphertext breaks the Merkle root", () => {
  it("a changed ciphertext, with its ciphertext_hash re-derived, gives FAIL merkle-root and exit 1", async () => {
    const s = await serveCopy((e) => {
      const r = findRecord(e, P2(), "TALLIED_PRECINCT");
      const victim = e.ballots.find((b) => b.precinct === P2() && b.code !== e.discarded) as Election["ballots"][number];
      const altered = victim.ciphertext.slice();
      altered[0] = (altered[0] as number) ^ 0xff;
      const listed = r.ballots.find((b) => b.tracking_code === victim.code) as (typeof r.ballots)[number];
      forbidden.push(String(r.ballots.indexOf(listed)));
      listed.ciphertext_hash = ciphertextHash(altered);
    });
    const res = await runCli(recordArgs(s));
    expect(res.code).toBe(1);
    expect(res.out).toMatch(
      new RegExp(`^FAIL merkle-root ${P2()}/TALLIED_PRECINCT: recomputed root [0-9a-f]{64} != published root [0-9a-f]{64}$`, "m"),
    );
  });

  it("a changed ciphertext_hash gives FAIL merkle-root and exit 1", async () => {
    const s = await serveCopy((e) => {
      const r = findRecord(e, P2(), "TALLIED_PRECINCT");
      (r.ballots[7] as (typeof r.ballots)[number]).ciphertext_hash = bytesToHex(sha256(new TextEncoder().encode("other")));
    });
    const res = await runCli(recordArgs(s));
    expect(res.code).toBe(1);
    expect(res.out).toMatch(new RegExp(`^FAIL merkle-root ${P2()}/TALLIED_PRECINCT: recomputed root`, "m"));
  });
});

describe("AC3: altering one total breaks the signature and the cross-checks", () => {
  it("a precinct total +1 gives FAIL signature for that record and FAIL C3", async () => {
    const s = await serveCopy((e) => {
      (findRecord(e, P1(), "TALLIED_PRECINCT").totals["contest-president"] as Record<string, number>)["cand-a"]! += 1;
    });
    const res = await runCli(recordArgs(s));
    expect(res.code).toBe(1);
    expect(res.out).toContain(`FAIL signature ${P1()}/TALLIED_PRECINCT: signature does not match the stage signing key`);
    expect(res.out).toMatch(
      new RegExp(`^FAIL C3 ${base.county}: contest-president/cand-a county total (\\d+) != sum of precinct totals \\d+$`, "m"),
    );
  });

  it("a certified total +1 gives FAIL signature for the certified record and FAIL C4", async () => {
    const s = await serveCopy((e) => {
      (findRecord(e, e.county, "CERTIFIED").totals["contest-president"] as Record<string, number>)["cand-c"]! += 1;
    });
    const res = await runCli(recordArgs(s));
    expect(res.code).toBe(1);
    expect(res.out).toContain(`FAIL signature ${base.county}/CERTIFIED: signature does not match the stage signing key`);
    expect(res.out).toMatch(new RegExp(`^FAIL C4 ${base.county}: contest-president/cand-c certified \\d+ > unofficial \\d+$`, "m"));
  });
});

describe("AC4: the signing key", () => {
  it("a record re-signed with a different key gives FAIL signature", async () => {
    const other = throwawaySigner();
    const s = await serveCopy((e) => void sign(findRecord(e, e.county, "REPORTED_UNOFFICIAL"), other));
    const res = await runCli(recordArgs(s));
    expect(res.code).toBe(1);
    expect(lines(res.out).filter((l) => l.startsWith("FAIL "))).toEqual([
      `FAIL signature ${base.county}/REPORTED_UNOFFICIAL: signature does not match the stage signing key`,
    ]);
  });

  it("no key at all (no --public-key, no STAGE_SIGNING_PUBLIC_KEY) exits 1", async () => {
    const s = await serveCopy();
    const res = await runCli(["record", "--base-url", s.url, ...scopeArgs(base)]);
    expect(res.code).toBe(1);
    expect(res.out).toContain(`FAIL signature ${P1()}/TALLIED_PRECINCT: ${NO_KEY_MESSAGE}`);
    expect(res.out).not.toMatch(/^PASS signature/m);
  });

  it("the key can come from STAGE_SIGNING_PUBLIC_KEY", async () => {
    const s = await serveCopy();
    const res = await runCli(["record", "--base-url", s.url, ...scopeArgs(base)], { env: { STAGE_SIGNING_PUBLIC_KEY: base.publicKey } });
    expect(res.code).toBe(0);
  });
});

describe("AC5: a ballot removed from certified without a challenge or discard", () => {
  it("gives FAIL C4 ... 1 ballots missing", async () => {
    const victim = codeFor(5000);
    const s = await serveCopy((e) => {
      const cert = findRecord(e, e.county, "CERTIFIED");
      cert.ballots = cert.ballots.filter((b) => b.tracking_code !== victim);
      rebuildAndSign(cert, e.signer);
    });
    const res = await runCli(recordArgs(s));
    expect(res.code).toBe(1);
    expect(lines(res.out).filter((l) => l.startsWith("FAIL "))).toEqual([
      `FAIL C4 ${base.county}: 1 ballots missing from certified with no challenge or discard: ${victim}`,
    ]);
  });

  it("the discarded and the open challenge in the fixture are explained, so C4 passes without them", async () => {
    const s = await serveCopy();
    const res = await runCli(recordArgs(s));
    expect(res.out).toContain(`PASS C4 ${base.county}`);
    expect(findRecord(base, base.county, "CERTIFIED").ballots.map((b) => b.tracking_code)).not.toContain(base.discarded);
    expect(findRecord(base, base.county, "CERTIFIED").ballots.map((b) => b.tracking_code)).not.toContain(base.openChallenge);
  });
});

describe("AC6: vbt-verify code", () => {
  const code = codeFor(4242);
  const codeArgs = (s: Server) => ["code", code, "--base-url", s.url, "--public-key", base.publicKey];

  async function serveTrack(edit: (t: ReturnType<typeof trackFor>) => void = () => {}) {
    const s = await serveCopy();
    const t = trackFor(s.election, code);
    edit(t);
    s.tracks.set(code, t);
    return s;
  }

  it("passes on an untouched ballot", async () => {
    const s = await serveTrack();
    const res = await runCli(codeArgs(s));
    expect(res.err).toBe("");
    expect(res.code).toBe(0);
    const out = lines(res.out);
    expect(out).toContain(`PASS chain ${code}`);
    const precinct = base.ballots.find((b) => b.code === code)?.precinct;
    for (const [scope, stage] of [[precinct, "TALLIED_PRECINCT"], [base.county, "REPORTED_UNOFFICIAL"], [base.county, "CERTIFIED"]]) {
      expect(out).toContain(`PASS signature ${scope}/${stage}`);
      expect(out).toContain(`PASS inclusion ${code} ${stage}`);
    }
  });

  it("changing one event's to_status gives FAIL chain", async () => {
    const s = await serveTrack((t) => void ((t.events[1] as (typeof t.events)[number]).to_status = "CHALLENGED"));
    const res = await runCli(codeArgs(s));
    expect(res.code).toBe(1);
    expect(res.out).toContain(`FAIL chain ${code}: event 3 from_status does not match the previous event's to_status`);
  });

  it.todo("changing the last event's to_status gives FAIL chain (needs an eventHash export from packages/crypto)");

  it("changing one prev_hash gives FAIL chain", async () => {
    const s = await serveTrack((t) => void ((t.events[2] as (typeof t.events)[number]).prev_hash = "0".repeat(64)));
    const res = await runCli(codeArgs(s));
    expect(res.code).toBe(1);
    expect(res.out).toContain(`FAIL chain ${code}: event 3 prev_hash does not match the previous event`);
  });

  it("a first event that is not CAST with a null prev_hash gives FAIL chain", async () => {
    const s = await serveTrack((t) => void ((t.events[0] as (typeof t.events)[number]).prev_hash = "0".repeat(64)));
    const res = await runCli(codeArgs(s));
    expect(res.code).toBe(1);
    expect(res.out).toContain(`FAIL chain ${code}: first event is not CAST with a null prev_hash`);
  });

  it("changing one link in its inclusion proof gives FAIL inclusion", async () => {
    const s = await serveTrack((t) => {
      const step = (t.proofs[0] as (typeof t.proofs)[number]).path[3] as { hash: string };
      step.hash = step.hash.replace(/^./, (c) => (c === "0" ? "1" : "0"));
    });
    const res = await runCli(codeArgs(s));
    expect(res.code).toBe(1);
    expect(res.out).toContain(`FAIL inclusion ${code} TALLIED_PRECINCT: proof does not reach the published root`);
  });

  it("a record that does not list the code gives FAIL inclusion ... code not in", async () => {
    const s = await serveTrack();
    const cert = findRecord(s.election, base.county, "CERTIFIED");
    cert.ballots = cert.ballots.filter((b) => b.tracking_code !== code);
    rebuildAndSign(cert, base.signer);
    const res = await runCli(codeArgs(s));
    expect(res.code).toBe(1);
    expect(res.out).toContain(`FAIL inclusion ${code} CERTIFIED: code not in ${base.county}/CERTIFIED`);
  });
});

describe("AC7: leaf order", () => {
  it("swapping two adjacent ballots gives FAIL leaf-order", async () => {
    const s = await serveCopy((e) => {
      const r = findRecord(e, P1(), "TALLIED_PRECINCT");
      const [a, b] = [r.ballots[100], r.ballots[101]] as [(typeof r.ballots)[number], (typeof r.ballots)[number]];
      r.ballots[100] = b;
      r.ballots[101] = a;
      forbidden.push("100", "101");
    });
    const res = await runCli(recordArgs(s));
    expect(res.code).toBe(1);
    expect(res.out).toContain(`FAIL leaf-order ${P1()}/TALLIED_PRECINCT: ballots are not sorted by ciphertext hash`);
  });
});

describe("duplicate ballots, re-signed by an insider with the key", () => {
  const victimIn = (e: Election, precinct: string) =>
    e.ballots.find((b) => b.precinct === precinct && b.code !== e.discarded && b.code !== e.openChallenge) as Election["ballots"][number];

  it("a ballot listed twice in a precinct record gives FAIL leaf-order and FAIL ballot-count", async () => {
    let code = "";
    const s = await serveCopy((e) => {
      const r = findRecord(e, P1(), "TALLIED_PRECINCT");
      code = victimIn(e, P1()).code;
      const listed = r.ballots.find((b) => b.tracking_code === code) as (typeof r.ballots)[number];
      r.ballots.push({ ...listed });
      rebuildAndSign(r, e.signer);
      const at = r.ballots.findIndex((b) => b.tracking_code === code);
      forbidden.push(String(at), String(at + 1));
    });
    const res = await runCli(recordArgs(s));
    expect(res.code).toBe(1);
    const failures = lines(res.out).filter((l) => l.startsWith("FAIL "));
    expect(failures).toContain(`FAIL leaf-order ${P1()}/TALLIED_PRECINCT: ballots list the same ciphertext hash more than once`);
    expect(failures).toContain(`FAIL ballot-count ${P1()}/TALLIED_PRECINCT: 1 tracking codes are listed more than once: ${code}`);
    expect(res.out).toContain(`PASS signature ${P1()}/TALLIED_PRECINCT`);
    expect(res.out).toContain(`PASS merkle-root ${P1()}/TALLIED_PRECINCT`);
  });

  it("one tracking code in two precincts and twice in the county gives FAIL ballot-count and FAIL C3", async () => {
    let code = "";
    const s = await serveCopy((e) => {
      code = victimIn(e, P1()).code;
      const copy = { tracking_code: code, ciphertext_hash: bytesToHex(sha256(new TextEncoder().encode("duplicate"))) };
      const p2 = findRecord(e, P2(), "TALLIED_PRECINCT");
      p2.ballots.push({ ...copy });
      rebuildAndSign(p2, e.signer);
      const county = findRecord(e, e.county, "REPORTED_UNOFFICIAL");
      county.ballots.push({ ...copy });
      rebuildAndSign(county, e.signer);
    });
    const res = await runCli(recordArgs(s));
    expect(res.code).toBe(1);
    const failures = lines(res.out).filter((l) => l.startsWith("FAIL "));
    expect(failures).toContain(`FAIL ballot-count ${base.county}/REPORTED_UNOFFICIAL: 1 tracking codes are listed more than once: ${code}`);
    expect(failures).toContain(`FAIL C3 ${base.county}: 1 tracking codes are listed more than once across precincts: ${code}`);
    expect(res.out).toContain(`PASS leaf-order ${base.county}/REPORTED_UNOFFICIAL`);
    expect(res.out).toContain(`PASS signature ${base.county}/REPORTED_UNOFFICIAL`);
  });
});

describe("AC8: format errors, network errors and unpublished stages", () => {
  it("a malformed body exits 2 with ERROR <url>: response is not a stage record", async () => {
    const s = await serveCopy();
    const path = `/api/record/${P1()}/TALLIED_PRECINCT`;
    s.raw.set(path, { status: 200, body: JSON.stringify({ scope: "precinct" }) });
    const res = await runCli(recordArgs(s));
    expect(res.code).toBe(2);
    expect(res.out).toBe("");
    expect(res.err).toContain(`ERROR ${s.url}${path}: response is not a stage record (scope_id missing or wrong type)`);
  });

  it("a body that is not JSON exits 2 with ERROR", async () => {
    const s = await serveCopy();
    s.raw.set(`/api/record/${base.county}/CERTIFIED`, { status: 200, body: "<html>" });
    const res = await runCli(recordArgs(s));
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/^ERROR \S+\/CERTIFIED: response is not a stage record \(body missing or wrong type\)$/m);
  });

  it("a network error exits 2 with ERROR", async () => {
    const s = await serveCopy();
    await s.close();
    servers.splice(servers.indexOf(s), 1);
    const res = await runCli(recordArgs(s));
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/^ERROR \S+\/api\/record\/\S+: network error$/m);
  });

  it("a 404 for a stage gives SKIP, and the checks that depend on it are skipped, not failed", async () => {
    const s = await serveCopy((e) => void (e.records = e.records.filter((r) => r.stage !== "CERTIFIED")));
    const res = await runCli(recordArgs(s));
    expect(res.code).toBe(0);
    expect(res.out).toContain(`SKIP ${base.county}/CERTIFIED: not published`);
    expect(res.out).toContain(`SKIP C4 ${base.county}: needs ${base.county}/CERTIFIED, not published`);
    expect(res.out).not.toMatch(/^FAIL/m);
    expect(lines(res.out).at(-1)).toMatch(/^PASSED: \d+ passed, 0 failed, 2 skipped$/);
  });
});

describe("AC9: download, then --from-dir with no network", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "vbt-verify-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const noNetwork = async (): Promise<never> => {
    throw new Error("network used");
  };

  it("gives the same results as the online run", async () => {
    const s = await serveCopy((e) => void (findRecord(e, e.county, "CERTIFIED").totals["contest-measure-1"]!.yes! += 1));
    const online = await runCli([...recordArgs(s), "--json"]);
    const saved = await runCli(["download", "--base-url", s.url, ...scopeArgs(base), "--out", dir]);
    expect(saved.code).toBe(0);
    expect(saved.out).toContain(`SAVED ${base.county}/CERTIFIED`);

    const offline = await runCli(
      ["record", "--from-dir", dir, ...scopeArgs(base), "--public-key", base.publicKey, "--json"],
      { fetch: noNetwork },
    );
    expect(offline.code).toBe(online.code);
    expect(offline.code).toBe(1);
    expect(JSON.parse(offline.out)).toEqual(JSON.parse(online.out));
  });

  it("code --from-dir reads a saved tracking lookup with no network", async () => {
    const code = codeFor(321);
    const s = await serveCopy();
    s.tracks.set(code, trackFor(s.election, code));
    const codeArgs = ["code", code, "--public-key", base.publicKey, "--json"];
    const online = await runCli([...codeArgs, "--base-url", s.url]);
    const codeDir = await mkdtemp(join(dir, "code-"));
    await runCli(["download", "--base-url", s.url, ...scopeArgs(base), "--out", codeDir]);
    await mkdir(join(codeDir, "api", "track"), { recursive: true });
    await writeFile(join(codeDir, "api", "track", `${code}.json`), JSON.stringify(s.tracks.get(code)));
    const offline = await runCli([...codeArgs, "--from-dir", codeDir], { fetch: noNetwork });
    expect(online.code).toBe(0);
    expect(offline.code).toBe(0);
    expect(JSON.parse(offline.out)).toEqual(JSON.parse(online.out));
  });

  it("a stage missing from the directory is SKIP, as a 404 is online", async () => {
    const emptyDir = await mkdtemp(join(dir, "empty-"));
    const res = await runCli(["record", "--from-dir", emptyDir, ...scopeArgs(base), "--public-key", base.publicKey], { fetch: noNetwork });
    expect(res.code).toBe(0);
    expect(res.out).toContain(`SKIP ${P1()}/TALLIED_PRECINCT: not published`);
    expect(res.out).toContain(`SKIP C3 ${base.county}: needs ${P1()}/TALLIED_PRECINCT, not published`);
  });
});

describe("AC10: output never shows a time, a leaf index or a ciphertext", () => {
  it("across every run in this file", () => {
    const failing = allRuns.filter((r) => r.code !== 0);
    expect(failing.length).toBeGreaterThanOrEqual(10);
    expect(leakingLines(allRuns, base, forbidden)).toEqual([]);
  });

  it("the scanner itself catches a time, a leaf index and a ciphertext", () => {
    const ciphertext = bytesToHex((base.ballots[0] as Election["ballots"][number]).ciphertext);
    const bad = [`FAIL x: cast at 14:05`, `FAIL x: leaf 12`, `FAIL x: ballots[3]`, `FAIL x: ${ciphertext}`, "FAIL x: at 100"];
    expect(leakingLines([{ code: 1, out: bad.join("\n"), err: "" }], base, ["100"])).toEqual(bad);
  });
});

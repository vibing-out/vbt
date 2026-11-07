// Builds a complete, signed public record for tests: N ballots across P
// precincts in one county, every published stage (TALLIED_PRECINCT per
// precinct; REPORTED_UNOFFICIAL, CHALLENGED, DISCARDED and CERTIFIED for the
// county), the tracking-code lookups, and a local http.createServer fake of
// the two public endpoints. Signed with a throwaway key through the test
// double in fake-crypto.ts.

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ContestTotals } from "../../src/crypto.ts";
import { main } from "../../src/cli.ts";
import { bytesToHex, hexToBytes, type PublishedRecord, type PublishedTrack, type Stage } from "../../src/record.ts";
import type { FetchLike } from "../../src/source.ts";
import { fakeCrypto, type FakeSigner, sha256, throwawaySigner } from "./fake-crypto.ts";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PRESIDENT = ["cand-a", "cand-b", "cand-c"] as const;
const MEASURE = ["yes", "no"] as const;
const enc = new TextEncoder();

export const COUNTY = "18097";

export function codeFor(i: number): string {
  let s = "";
  for (let n = i, k = 0; k < 4; k++, n = Math.floor(n / 32)) s = CROCKFORD[n % 32] + s;
  return `RIVER-MAPLE-${s}-HAWK`;
}

export type Ballot = { code: string; precinct: string; ciphertext: Uint8Array; president: string; measure: string };

export type Election = {
  county: string;
  precincts: string[];
  ballots: Ballot[];
  records: PublishedRecord[];
  signer: FakeSigner;
  /** Base64 stage signing public key, as a user would pass it. */
  publicKey: string;
  /** Discarded (index 0), challenged and still open (index 1), challenged then accepted (index 2). */
  discarded: string;
  openChallenge: string;
  acceptedChallenge: string;
};

export const ciphertextHash = (ciphertext: Uint8Array) => bytesToHex(sha256(ciphertext));

function tally(ballots: Ballot[]): ContestTotals {
  const t: ContestTotals = {
    "contest-president": Object.fromEntries(PRESIDENT.map((c) => [c, 0])),
    "contest-measure-1": Object.fromEntries(MEASURE.map((c) => [c, 0])),
  };
  for (const b of ballots) {
    (t["contest-president"] as Record<string, number>)[b.president]! += 1;
    (t["contest-measure-1"] as Record<string, number>)[b.measure]! += 1;
  }
  return t;
}

export function sign(r: PublishedRecord, signer: FakeSigner): PublishedRecord {
  r.signature = bytesToHex(
    signer.sign({ scope: r.scope_id, stage: r.stage, merkleRoot: r.merkle_root, ballotCount: r.ballot_count, totals: r.totals }),
  );
  return r;
}

/** Re-sort by ciphertext hash, recompute root and count, and re-sign: what an insider with the key could do. */
export function rebuildAndSign(r: PublishedRecord, signer: FakeSigner): PublishedRecord {
  r.ballots.sort((a, b) => (a.ciphertext_hash < b.ciphertext_hash ? -1 : 1));
  r.merkle_root = bytesToHex(fakeCrypto.buildMerkleTree(r.ballots.map((b) => hexToBytes(b.ciphertext_hash))).root);
  r.ballot_count = r.ballots.length;
  return sign(r, signer);
}

function record(scopeId: string, stage: Stage, ballots: Ballot[], totals: ContestTotals, date: string, signer: FakeSigner) {
  return rebuildAndSign(
    {
      scope: stage === "TALLIED_PRECINCT" ? "precinct" : "county",
      scope_id: scopeId,
      stage,
      merkle_root: "",
      ballot_count: 0,
      totals,
      published_on: date,
      signature: "",
      ballots: ballots.map((b) => ({ tracking_code: b.code, ciphertext_hash: ciphertextHash(b.ciphertext) })),
    },
    signer,
  );
}

export function buildElection({ ballots: n = 10_000, precincts: p = 4 } = {}): Election {
  const signer = throwawaySigner();
  const precincts = Array.from({ length: p }, (_, i) => `${COUNTY}-${String(i + 1).padStart(3, "0")}`);
  const ballots: Ballot[] = Array.from({ length: n }, (_, i) => ({
    code: codeFor(i),
    precinct: precincts[i % p] as string,
    ciphertext: sha256(enc.encode(`ciphertext-${i}`)),
    president: PRESIDENT[(i * 7) % 3] as string,
    measure: MEASURE[(i * 5) % 2] as string,
  }));
  const [discarded, open, accepted] = ballots as [Ballot, Ballot, Ballot];
  const certified = ballots.filter((b) => b !== discarded && b !== open);
  const records = [
    ...precincts.map((id) => {
      const mine = ballots.filter((b) => b.precinct === id);
      return record(id, "TALLIED_PRECINCT", mine, tally(mine), "2026-11-03", signer);
    }),
    record(COUNTY, "REPORTED_UNOFFICIAL", ballots, tally(ballots), "2026-11-04", signer),
    record(COUNTY, "CHALLENGED", [discarded, open, accepted], {}, "2026-11-10", signer),
    record(COUNTY, "DISCARDED", [discarded], {}, "2026-11-12", signer),
    record(COUNTY, "CERTIFIED", certified, tally(certified), "2026-11-17", signer),
  ];
  return {
    county: COUNTY,
    precincts,
    ballots,
    records,
    signer,
    publicKey: Buffer.from(signer.publicKey).toString("base64"),
    discarded: discarded.code,
    openChallenge: open.code,
    acceptedChallenge: accepted.code,
  };
}

export const clone = (e: Election): Election => ({ ...e, records: structuredClone(e.records) });

export function findRecord(e: Election, scopeId: string, stage: Stage): PublishedRecord {
  const r = e.records.find((x) => x.scope_id === scopeId && x.stage === stage);
  if (!r) throw new Error(`fixture has no ${scopeId}/${stage}`);
  return r;
}

/** The public lookup for one certified ballot: dated, linked events and a proof per record that lists it. */
export function trackFor(e: Election, code: string): PublishedTrack {
  const ballot = e.ballots.find((b) => b.code === code);
  if (!ballot) throw new Error("no such ballot");
  const steps: [string, string | null, string, string][] = [
    ["CAST", null, "CAST", "2026-11-03"],
    ["STATUS_CHANGE", "CAST", "TALLIED_PRECINCT", "2026-11-03"],
    ["STATUS_CHANGE", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "2026-11-04"],
    ["STATUS_CHANGE", "REPORTED_UNOFFICIAL", "CERTIFIED", "2026-11-17"],
  ];
  // Event hashes are opaque random values here: the verifier checks linkage only (no event-hash export yet).
  let prev: string | null = null;
  const events = steps.map(([event_type, from_status, to_status, date]) => {
    const hash = randomBytes(32).toString("hex");
    const ev = { event_type, from_status, to_status, date, prev_hash: prev, hash };
    prev = hash;
    return ev;
  });
  const proofs = e.records
    .filter((r) => r.ballots.some((b) => b.tracking_code === code))
    .map((r) => {
      const tree = fakeCrypto.buildMerkleTree(r.ballots.map((b) => hexToBytes(b.ciphertext_hash)));
      const proof = tree.proofs[r.ballots.findIndex((b) => b.tracking_code === code)];
      return {
        scope_id: r.scope_id,
        stage: r.stage,
        path: (proof?.steps ?? []).map((s) => ({ side: s.side, hash: bytesToHex(s.sibling) })),
      };
    });
  return { status: "CERTIFIED", ciphertext_hash: ciphertextHash(ballot.ciphertext), events, proofs };
}

// --- A local fake of the public API ---

export type Server = {
  url: string;
  /** Override one path (such as /api/record/18097/CERTIFIED) with a raw status and body. */
  raw: Map<string, { status: number; body: string }>;
  /** Tracking-code lookups served at /api/track/{code}. */
  tracks: Map<string, PublishedTrack>;
  election: Election;
  close(): Promise<void>;
};

export async function serve(election: Election): Promise<Server> {
  const server: Server = {
    url: "",
    raw: new Map(),
    tracks: new Map(),
    election,
    close: () => new Promise((resolve) => http.close(() => resolve())),
  };
  const http = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const send = (status: number, body: string) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
    };
    const raw = server.raw.get(path);
    if (raw) return send(raw.status, raw.body);
    const rec = path.match(/^\/api\/record\/([^/]+)\/([^/]+)$/);
    const trk = path.match(/^\/api\/track\/([^/]+)$/);
    let body: unknown;
    if (rec) {
      body = server.election.records.find((r) => r.scope_id === decodeURIComponent(rec[1] as string) && r.stage === rec[2]);
    }
    if (trk) body = server.tracks.get(decodeURIComponent(trk[1] as string));
    return body === undefined ? send(404, '{"error":"not found"}') : send(200, JSON.stringify(body));
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  server.url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return server;
}

// --- Running the CLI ---

export type Run = { code: number; out: string; err: string };

/** Every run's output, so AC10 can scan all of it. */
export const allRuns: Run[] = [];

export async function runCli(argv: string[], opts: { fetch?: FetchLike; env?: Record<string, string> } = {}): Promise<Run> {
  let out = "";
  let err = "";
  const code = await main(argv, {
    crypto: fakeCrypto,
    env: opts.env ?? {},
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    out: (t) => (out += t),
    err: (t) => (err += t),
  });
  const run = { code, out, err };
  allRuns.push(run);
  return run;
}

export const scopeArgs = (e: Election) => ["--county", e.county, ...e.precincts.flatMap((p) => ["--precinct", p])];

export const recordArgs = (s: Server, key = s.election.publicKey) => [
  "record",
  "--base-url",
  s.url,
  ...scopeArgs(s.election),
  "--public-key",
  key,
];

// --- AC10: what output must never contain ---

const TIME = /\d{2}:\d{2}/;
const LEAF_INDEX = /\bleaf\b(?!-order)|\bindex\b|\bposition\b|\[\d+\]/i;

/**
 * Output lines that show a time, mention a leaf index, contain any ballot's
 * ciphertext (hex or base64), or contain one of `forbidden` (such as the
 * position of a ballot the test altered).
 */
export function leakingLines(runs: Run[], e: Election, forbidden: string[] = []): string[] {
  const ciphertexts = e.ballots.flatMap((b) => [bytesToHex(b.ciphertext), Buffer.from(b.ciphertext).toString("base64")]);
  const tokens = new Set(ciphertexts);
  return runs
    .flatMap((r) => `${r.out}\n${r.err}`.split("\n"))
    .filter((line) => {
      // URLs carry a port (127.0.0.1:NNNNN); take them out before the time check.
      const text = line.replace(/https?:\/\/[^\s/]+/g, "<origin>");
      if (TIME.test(text) || LEAF_INDEX.test(text)) return true;
      if (forbidden.some((f) => new RegExp(`(^|[^0-9A-Za-z])${f}([^0-9A-Za-z]|$)`).test(text))) return true;
      return text.split(/[\s:,()/]+/).some((t) => tokens.has(t));
    });
}

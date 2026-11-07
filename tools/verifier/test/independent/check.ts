// An independent stage-record checker, written only from docs/record-format.md.
//
// It deliberately imports nothing from this repository (no @vbt/crypto, @vbt/events or
// tools/verifier/src) and no third-party package: only Node's built-in crypto. If it agrees with
// tools/verifier, the document is complete enough to check a record without trusting our code.
// Section numbers (§) refer to docs/record-format.md.

import { createHash, createPublicKey, verify } from "node:crypto";

export type Totals = Record<string, Record<string, number>>;
export type Ballot = { tracking_code: string; ciphertext_hash: string };
export type StageRecordJson = {
  scope: string;
  scope_id: string;
  stage: string;
  merkle_root: string;
  ballot_count: number;
  totals: Totals;
  published_on: string;
  signature: string;
  ballots: Ballot[];
};
export type ProofJson = { scope_id: string; stage: string; path: { side: string; hash: string }[] };
export type Verdict = { check: string; scope_id: string; stage: string; ok: boolean };

// §1, §4: SHA-256, lowercase hex.
const sha256 = (...parts: Uint8Array[]): Buffer => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};
const fromHex = (hex: string): Buffer => {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("not 64 lowercase hex characters");
  return Buffer.from(hex, "hex");
};

// §1: canonical JSON, keys sorted by UTF-16 code unit at every level, no whitespace.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// §5.1: leaf = UTF-8(tracking_code) || 0x00 || 32 bytes of ciphertext_hash.
export const leaf = (b: Ballot): Buffer => Buffer.concat([Buffer.from(b.tracking_code, "utf8"), Buffer.of(0x00), fromHex(b.ciphertext_hash)]);

// §5.2: domain-separated leaf and node hashes.
const leafHash = (l: Uint8Array) => sha256(Buffer.of(0x00), l);
const nodeHash = (left: Uint8Array, right: Uint8Array) => sha256(Buffer.of(0x01), left, right);

// §5.3: ciphertext_hash, then tracking_code, by plain code-unit comparison.
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const leafOrder = (a: Ballot, b: Ballot) => cmp(a.ciphertext_hash, b.ciphertext_hash) || cmp(a.tracking_code, b.tracking_code);

// §5.4: odd hash promoted unchanged; empty tree is SHA-256("").
export function merkleRoot(ballots: readonly Ballot[]): string {
  if (ballots.length === 0) return sha256().toString("hex");
  let level = [...ballots].sort(leafOrder).map((b) => leafHash(leaf(b)));
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const right = level[i + 1];
      next.push(right ? nodeHash(level[i] as Buffer, right) : (level[i] as Buffer));
    }
    level = next;
  }
  return (level[0] as Buffer).toString("hex");
}

// §6.3: 128 lowercase hex characters are hex; anything else is base64.
const signatureBytes = (s: string): Buffer => Buffer.from(s, /^[0-9a-f]{128}$/.test(s) ? "hex" : "base64");

// §6.1: Ed25519 over UTF-8 canonical JSON of {scope, stage, merkleRoot, ballotCount, totals}.
// §6.2: the key is the election office's 32-byte public key, passed in by the caller.
export function signatureValid(r: StageRecordJson, officePublicKey: Uint8Array): boolean {
  try {
    const message = Buffer.from(
      canonical({ scope: r.scope, stage: r.stage, merkleRoot: r.merkle_root, ballotCount: r.ballot_count, totals: r.totals }),
      "utf8",
    );
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(officePublicKey).toString("base64url") }, format: "jwk" });
    return verify(null, message, key, signatureBytes(r.signature));
  } catch {
    return false;
  }
}

// §10: the four per-record checks.
export function checkRecord(r: StageRecordJson, officePublicKey: Uint8Array): Verdict[] {
  const v = (check: string, ok: boolean): Verdict => ({ check, scope_id: r.scope_id, stage: r.stage, ok });
  const codes = r.ballots.map((b) => b.tracking_code);
  const sorted = r.ballots.every((b, i) => i === 0 || leafOrder(r.ballots[i - 1] as Ballot, b) < 0);
  let rootOk: boolean;
  try {
    rootOk = merkleRoot(r.ballots) === r.merkle_root;
  } catch {
    rootOk = false;
  }
  return [
    v("ballot-count", r.ballot_count === r.ballots.length && new Set(codes).size === codes.length),
    v("leaf-order", sorted),
    v("merkle-root", rootOk),
    v("signature", signatureValid(r, officePublicKey)),
  ];
}

// §9: missing contests or choices count as 0.
const at = (t: Totals, c: string, k: string) => t[c]?.[k] ?? 0;
const pairs = (...ts: Totals[]) => {
  const seen = new Map<string, [string, string]>();
  for (const t of ts) for (const c of Object.keys(t)) for (const k of Object.keys(t[c] ?? {})) seen.set(`${c}\u0000${k}`, [c, k]);
  return [...seen.values()];
};
const setOf = (r: StageRecordJson) => new Map(r.ballots.map((b) => [b.tracking_code, b.ciphertext_hash]));

/** §9 C2. */
export function c2(p: StageRecordJson): Verdict {
  const ok = pairs(p.totals).every(([c, k]) => {
    const n = at(p.totals, c, k);
    return Number.isInteger(n) && n >= 0 && n <= p.ballot_count;
  });
  return { check: "c2", scope_id: p.scope_id, stage: p.stage, ok };
}

/** §9 C3. */
export function c3(precincts: readonly StageRecordJson[], county: StageRecordJson): Verdict {
  const sumsMatch = pairs(county.totals, ...precincts.map((p) => p.totals)).every(
    ([c, k]) => at(county.totals, c, k) === precincts.reduce((n, p) => n + at(p.totals, c, k), 0),
  );
  const countMatches = county.ballot_count === precincts.reduce((n, p) => n + p.ballot_count, 0);
  const union = new Map<string, string>();
  let inTwo = false;
  for (const p of precincts) {
    for (const [code, hash] of setOf(p)) {
      if (union.has(code)) inTwo = true;
      union.set(code, hash);
    }
  }
  const countySet = setOf(county);
  const setsEqual = countySet.size === union.size && [...countySet].every(([code, hash]) => union.get(code) === hash);
  return { check: "c3", scope_id: county.scope_id, stage: county.stage, ok: sumsMatch && countMatches && !inTwo && setsEqual };
}

/** §9 C4. */
export function c4(u: StageRecordJson, c: StageRecordJson, challenged: StageRecordJson | null, discarded: StageRecordJson | null): Verdict {
  const before = setOf(u);
  const after = setOf(c);
  const certifiedInUnofficial = [...after].every(([code, hash]) => before.get(code) === hash);
  const explained = new Set([...(challenged?.ballots ?? []), ...(discarded?.ballots ?? [])].map((b) => b.tracking_code));
  const removed = [...before.keys()].filter((code) => !after.has(code));
  const allExplained = removed.every((code) => explained.has(code));
  const totalsOk = pairs(u.totals, c.totals).every(([k1, k2]) => {
    const cert = at(c.totals, k1, k2);
    const unof = at(u.totals, k1, k2);
    return cert <= unof && unof - cert <= removed.length;
  });
  return { check: "c4", scope_id: c.scope_id, stage: c.stage, ok: certifiedInUnofficial && allExplained && totalsOk };
}

/** §7: the proof climbs from the receipt's leaf to the record's root, and the record lists the code with that hash. */
export function inclusion(r: StageRecordJson, code: string, ciphertextHash: string, proof: ProofJson): Verdict {
  let reaches = false;
  try {
    let h = leafHash(leaf({ tracking_code: code, ciphertext_hash: ciphertextHash }));
    for (const step of proof.path) {
      if (step.side === "left") h = nodeHash(fromHex(step.hash), h);
      else if (step.side === "right") h = nodeHash(h, fromHex(step.hash));
      else throw new Error("bad side");
    }
    reaches = h.toString("hex") === r.merkle_root;
  } catch {
    reaches = false;
  }
  const listed = r.ballots.some((b) => b.tracking_code === code && b.ciphertext_hash === ciphertextHash);
  return { check: "inclusion", scope_id: code, stage: proof.stage, ok: reaches && listed };
}

export type County = {
  precincts: readonly StageRecordJson[];
  unofficial?: StageRecordJson | null;
  certified?: StageRecordJson | null;
  challenged?: StageRecordJson | null;
  discarded?: StageRecordJson | null;
};

/** §10 for one county, in the same order as the checklist. */
export function verifyCounty(county: County, officePublicKey: Uint8Array): Verdict[] {
  const { precincts, unofficial = null, certified = null, challenged = null, discarded = null } = county;
  const out: Verdict[] = [];
  for (const r of [...precincts, unofficial, certified, challenged, discarded]) if (r) out.push(...checkRecord(r, officePublicKey));
  for (const p of precincts) out.push(c2(p));
  if (unofficial) out.push(c3(precincts, unofficial));
  if (unofficial && certified) out.push(c4(unofficial, certified, challenged, discarded));
  return out;
}

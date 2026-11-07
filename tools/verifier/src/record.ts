// Shapes of the public record (docs/locked-interfaces.md § API boundaries,
// "Public JSON shapes") and type guards for them. A body that does not match
// is a format error: the run stops with exit 2 and names the field, never its
// value and never an array position (a ballot's position is its leaf index).

import type { ContestTotals } from "./crypto.ts";

export type Scope = "precinct" | "county";

/** Published stages and the scope each is batched per. */
export const STAGE_SCOPE = {
  TALLIED_PRECINCT: "precinct",
  REPORTED_UNOFFICIAL: "county",
  CERTIFIED: "county",
  CHALLENGED: "county",
  DISCARDED: "county",
} as const satisfies Record<string, Scope>;

export type Stage = keyof typeof STAGE_SCOPE;

export const PRECINCT_STAGES = ["TALLIED_PRECINCT"] as const satisfies readonly Stage[];
export const COUNTY_STAGES = ["REPORTED_UNOFFICIAL", "CERTIFIED", "CHALLENGED", "DISCARDED"] as const satisfies readonly Stage[];

export type PublishedBallot = { tracking_code: string; ciphertext_hash: string };

export type PublishedRecord = {
  scope: Scope;
  scope_id: string;
  stage: Stage;
  merkle_root: string;
  ballot_count: number;
  /** Numbers only; whether each is a non-negative integer is check C2, not the parser. */
  totals: ContestTotals;
  published_on: string;
  signature: string;
  ballots: PublishedBallot[];
};

export type PublishedEvent = {
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  date: string;
  prev_hash: string | null;
  hash: string;
};

export type PublishedProof = { scope_id: string; stage: Stage; path: { side: "left" | "right"; hash: string }[] };

export type PublishedTrack = {
  status: string;
  ciphertext_hash: string;
  events: PublishedEvent[];
  proofs: PublishedProof[];
};

export const HEX_32 = /^[0-9a-f]{64}$/;
export const HEX_64 = /^[0-9a-f]{128}$/;
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** Safe as a URL path segment and a file name. */
export const SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The body is not the documented shape. `field` names the first field that is missing or has the wrong type. */
export class FormatError extends Error {
  readonly field: string;
  constructor(field: string) {
    super(`${field} missing or wrong type`);
    this.name = "FormatError";
    this.field = field;
  }
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStage = (v: unknown): v is Stage => typeof v === "string" && Object.hasOwn(STAGE_SCOPE, v);

function need<T>(ok: boolean, field: string, value: T): T {
  if (!ok) throw new FormatError(field);
  return value;
}

function str(o: Obj, key: string, field = key): string {
  const v = o[key];
  return need(typeof v === "string" && v.length > 0, field, v as string);
}

function hex32(o: Obj, key: string, field = key): string {
  const v = o[key];
  return need(typeof v === "string" && HEX_32.test(v), field, v as string);
}

function nullableHex32(o: Obj, key: string, field: string): string | null {
  const v = o[key];
  if (v === null) return null;
  return need(typeof v === "string" && HEX_32.test(v), field, v as string);
}

function nullableStr(o: Obj, key: string, field: string): string | null {
  const v = o[key];
  if (v === null) return null;
  return need(typeof v === "string" && v.length > 0, field, v as string);
}

function parseTotals(v: unknown): ContestTotals {
  need(isObj(v), "totals", v);
  const totals: ContestTotals = {};
  for (const [contest, row] of Object.entries(v as Obj)) {
    need(isObj(row), `totals.${contest}`, row);
    const out: Record<string, number> = {};
    for (const [choice, count] of Object.entries(row as Obj)) {
      out[choice] = need(typeof count === "number" && Number.isFinite(count), `totals.${contest}.${choice}`, count as number);
    }
    totals[contest] = out;
  }
  return totals;
}

/** Type guard for GET /api/record/{scope_id}/{stage}. Throws FormatError. */
export function parseRecord(value: unknown): PublishedRecord {
  need(isObj(value), "body", value);
  const o = value as Obj;
  const scope = need(o.scope === "precinct" || o.scope === "county", "scope", o.scope as Scope);
  const scope_id = str(o, "scope_id");
  need(SCOPE_ID.test(scope_id), "scope_id", scope_id);
  const stage = need(isStage(o.stage), "stage", o.stage as Stage);
  need(STAGE_SCOPE[stage] === scope, "scope", scope);
  const merkle_root = hex32(o, "merkle_root");
  const ballot_count = need(Number.isSafeInteger(o.ballot_count) && (o.ballot_count as number) >= 0, "ballot_count", o.ballot_count as number);
  const totals = parseTotals(o.totals);
  const published_on = str(o, "published_on");
  need(DATE_ONLY.test(published_on), "published_on", published_on);
  const signature = need(typeof o.signature === "string" && HEX_64.test(o.signature), "signature", o.signature as string);
  need(Array.isArray(o.ballots), "ballots", o.ballots);
  const ballots = (o.ballots as unknown[]).map((b): PublishedBallot => {
    need(isObj(b), "ballots", b);
    const ballot = b as Obj;
    return {
      tracking_code: str(ballot, "tracking_code", "ballots.tracking_code"),
      ciphertext_hash: hex32(ballot, "ciphertext_hash", "ballots.ciphertext_hash"),
    };
  });
  return { scope, scope_id, stage, merkle_root, ballot_count, totals, published_on, signature, ballots };
}

/** Type guard for GET /api/track/{code}. Throws FormatError. */
export function parseTrack(value: unknown): PublishedTrack {
  need(isObj(value), "body", value);
  const o = value as Obj;
  const status = str(o, "status");
  const ciphertext_hash = hex32(o, "ciphertext_hash");
  need(Array.isArray(o.events) && o.events.length > 0, "events", o.events);
  const events = (o.events as unknown[]).map((e): PublishedEvent => {
    need(isObj(e), "events", e);
    const ev = e as Obj;
    const date = str(ev, "date", "events.date");
    need(DATE_ONLY.test(date), "events.date", date);
    return {
      event_type: str(ev, "event_type", "events.event_type"),
      from_status: nullableStr(ev, "from_status", "events.from_status"),
      to_status: nullableStr(ev, "to_status", "events.to_status"),
      date,
      prev_hash: nullableHex32(ev, "prev_hash", "events.prev_hash"),
      hash: hex32(ev, "hash", "events.hash"),
    };
  });
  need(Array.isArray(o.proofs), "proofs", o.proofs);
  const proofs = (o.proofs as unknown[]).map((p): PublishedProof => {
    need(isObj(p), "proofs", p);
    const pr = p as Obj;
    const scope_id = str(pr, "scope_id", "proofs.scope_id");
    need(SCOPE_ID.test(scope_id), "proofs.scope_id", scope_id);
    const stage = need(isStage(pr.stage), "proofs.stage", pr.stage as Stage);
    need(Array.isArray(pr.path), "proofs.path", pr.path);
    const path = (pr.path as unknown[]).map((s) => {
      need(isObj(s), "proofs.path", s);
      const step = s as Obj;
      const side = need(step.side === "left" || step.side === "right", "proofs.path.side", step.side as "left" | "right");
      return { side, hash: hex32(step, "hash", "proofs.path.hash") };
    });
    return { scope_id, stage, path };
  });
  return { status, ciphertext_hash, events, proofs };
}

// --- Encoding only (no hashing): the record carries bytes as lowercase hex. ---

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) throw new TypeError("not lowercase hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

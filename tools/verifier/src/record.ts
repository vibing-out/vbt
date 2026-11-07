// The published stage record (docs/record-format.md §3) and a strict parser for it. A body that does
// not match is a format error naming the field, never its value and never an array position (a
// ballot's position is its leaf index).

export type Scope = "precinct" | "county";

/** Published stages and the scope each is batched per (docs/record-format.md §2). */
export const STAGE_SCOPE = {
  TALLIED_PRECINCT: "precinct",
  REPORTED_UNOFFICIAL: "county",
  CERTIFIED: "county",
  CHALLENGED: "county",
  DISCARDED: "county",
} as const satisfies Record<string, Scope>;

export type Stage = keyof typeof STAGE_SCOPE;

/** contestId → choiceId → count. Numbers only; whether each is a count is check C2. */
export type Totals = Record<string, Record<string, number>>;

export type PublishedBallot = { tracking_code: string; ciphertext_hash: string };

export type PublishedRecord = {
  scope: Scope;
  scope_id: string;
  stage: Stage;
  merkle_root: string;
  ballot_count: number;
  totals: Totals;
  published_on: string;
  /** Base64 (as stage_records stores it) or 128 hex (the T-15 draft); see docs/record-format.md §6.3. */
  signature: string;
  ballots: PublishedBallot[];
};

/** An inclusion proof as GET /api/track/{code} lists it (docs/record-format.md §7). */
export type PublishedProof = { scope_id: string; stage: Stage; path: { side: "left" | "right"; hash: string }[] };

export const HEX_32 = /^[0-9a-f]{64}$/;
const HEX_64 = /^[0-9a-f]{128}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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

function need(ok: boolean, field: string): void {
  if (!ok) throw new FormatError(field);
}

function str(o: Obj, key: string, field: string): string {
  const v = o[key];
  need(typeof v === "string" && v.length > 0, field);
  return v as string;
}

function parseTotals(v: unknown): Totals {
  need(isObj(v), "totals");
  const totals: Totals = {};
  for (const [contest, row] of Object.entries(v as Obj)) {
    need(isObj(row), "totals");
    const out: Record<string, number> = {};
    for (const [choice, count] of Object.entries(row as Obj)) {
      need(typeof count === "number" && Number.isFinite(count), "totals");
      out[choice] = count as number;
    }
    totals[contest] = out;
  }
  return totals;
}

/** Parses a stage record. Throws FormatError. */
export function parseRecord(value: unknown): PublishedRecord {
  need(isObj(value), "body");
  const o = value as Obj;
  need(o.scope === "precinct" || o.scope === "county", "scope");
  const scope = o.scope as Scope;
  const scope_id = str(o, "scope_id", "scope_id");
  need(isStage(o.stage), "stage");
  const stage = o.stage as Stage;
  need(STAGE_SCOPE[stage] === scope, "scope");
  const merkle_root = str(o, "merkle_root", "merkle_root");
  need(HEX_32.test(merkle_root), "merkle_root");
  need(Number.isSafeInteger(o.ballot_count) && (o.ballot_count as number) >= 0, "ballot_count");
  const totals = parseTotals(o.totals);
  const published_on = str(o, "published_on", "published_on");
  need(DATE_ONLY.test(published_on), "published_on");
  const signature = str(o, "signature", "signature");
  need(HEX_64.test(signature) || BASE64.test(signature), "signature");
  need(Array.isArray(o.ballots), "ballots");
  const ballots = (o.ballots as unknown[]).map((b): PublishedBallot => {
    need(isObj(b), "ballots");
    const tracking_code = str(b as Obj, "tracking_code", "ballots.tracking_code");
    need(!tracking_code.includes("\u0000"), "ballots.tracking_code");
    const ciphertext_hash = str(b as Obj, "ciphertext_hash", "ballots.ciphertext_hash");
    need(HEX_32.test(ciphertext_hash), "ballots.ciphertext_hash");
    return { tracking_code, ciphertext_hash };
  });
  return { scope, scope_id, stage, merkle_root, ballot_count: o.ballot_count as number, totals, published_on, signature, ballots };
}

/** The signature's 64 bytes from 128 hex characters or base64 (docs/record-format.md §6.3). */
export function signatureBytes(signature: string): Uint8Array {
  return new Uint8Array(Buffer.from(signature, HEX_64.test(signature) ? "hex" : "base64"));
}

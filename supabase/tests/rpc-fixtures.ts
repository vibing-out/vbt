// Payload builders for the T-05 RPC tests, shaped the way apps/web/lib/ingest.ts and batches.ts build
// them. Ciphertexts are random bytes: the RPCs store and hash-check, they never decrypt.
import { randomBytes } from "node:crypto";
import type pg from "pg";
import { castOccurredAt, chainEvent, type ChainedEvent, orderChain, sha256Hex } from "@vbt/events";

export const PRECINCT = "P-T05-1";
export const OTHER_PRECINCT = "P-T05-2";
export const COUNTY = "C-T05";
export const OTHER_COUNTY = "C-T05-OTHER";
export const MACHINE = "M-T05-1";
export const OFFICIAL = "00000000-0000-4000-8000-0000000000c1";

/** Precincts and a machine for the tests (run as the owner, before switching role). */
export async function seedPlaces(client: pg.Client): Promise<void> {
  await client.query(
    `insert into public.precincts (id, county_id, name) values ($1, $3, 'T05 One'), ($2, $4, 'T05 Two')
     on conflict do nothing`,
    [PRECINCT, OTHER_PRECINCT, COUNTY, OTHER_COUNTY],
  );
  await client.query(
    `insert into public.machines (id, precinct_id, vendor, model, public_key) values ($1, $2, 'v', 'm', 'k')
     on conflict do nothing`,
    [MACHINE, PRECINCT],
  );
}

export type NewBallot = {
  tracking_code: string;
  prev_tracking_code: string | null;
  ciphertext: string;
  ciphertext_hash: string;
  ballot_style: string;
  precinct_id: string;
  machine_id: string;
  cast_date: string;
  occurred_at: string;
  actor_role: "machine";
  actor_id: string;
  hash: string;
};

export function newBallot(code: string, options: { precinct?: string; ciphertext?: Uint8Array } = {}): NewBallot {
  const bytes = options.ciphertext ?? randomBytes(48);
  const cast = chainEvent(
    { tracking_code: code, event_type: "CAST", from_status: null, to_status: null, reason: null, occurred_on: "2026-11-03" },
    null,
  );
  return {
    tracking_code: code,
    prev_tracking_code: null,
    ciphertext: Buffer.from(bytes).toString("base64"),
    ciphertext_hash: sha256Hex(bytes),
    ballot_style: "style-general",
    precinct_id: options.precinct ?? PRECINCT,
    machine_id: MACHINE,
    cast_date: "2026-11-03",
    occurred_at: castOccurredAt("2026-11-03"),
    actor_role: "machine",
    actor_id: MACHINE,
    hash: cast.hash,
  };
}

export function ingestPayload(ballots: NewBallot[], extra: { mismatches?: unknown[]; county?: string; sha?: string } = {}) {
  return {
    sha256: extra.sha ?? sha256Hex(randomBytes(16)),
    kind: "ballot_record",
    actor_id: OFFICIAL,
    county_id: extra.county ?? COUNTY,
    ballot_count: ballots.length + (extra.mismatches?.length ?? 0),
    ballots,
    mismatches: extra.mismatches ?? [],
  };
}

/** A ballot's events in chain order, with the public hash-chain fields. */
export async function chainOf(client: pg.Client, code: string): Promise<ChainedEvent[]> {
  const { rows } = await client.query<ChainedEvent>(
    `select b.tracking_code, e.event_type, e.from_status, e.to_status, e.reason,
            to_char(e.occurred_on, 'YYYY-MM-DD') as occurred_on, e.prev_hash, e.hash
     from private.ballot_events e join private.ballots b on b.id = e.ballot_id
     where b.tracking_code = $1`,
    [code],
  );
  const ordered = orderChain(rows);
  if (!ordered) throw new Error(`events of ${code} are not one chain`);
  return ordered;
}

export async function count(client: pg.Client, table: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return rows[0]!.n;
}

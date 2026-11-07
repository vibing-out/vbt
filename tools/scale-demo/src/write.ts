// Writes a built seed into the product database over a direct Postgres connection (private.ballots and
// private.ballot_events are not in the Data API: 20261107200000_private_base_tables.sql).
//
// One transaction, as service_role. ballot_events and stage_records are insert-only, so a run can never
// be undone: the writer refuses a database that already has the demo county. Ballots go in as CAST and
// not mismatched; afterwards only current_status and mismatch change (the only columns service_role
// may update).

import { localDatabaseUrl } from "@vbt/supabase/lib/db.ts";
import pg from "pg";
import { buildRows, readKeys, type SeedRows } from "./build.ts";
import { type CryptoAdapter, DEFAULT_CRYPTO } from "./crypto-adapter.ts";
import { buildPlan, type PlanOptions } from "./plan.ts";

export const CHUNK = 1_000;

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

function chunks<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

const col = <T, K extends keyof T>(rows: readonly T[], key: K): Array<T[K]> => rows.map((r) => r[key]);

export class AlreadySeededError extends Error {
  constructor(countyId: string) {
    super(`${countyId} is already in this database; its events are insert-only, so the seed runs only once`);
  }
}

/** Inserts every row inside the caller's open transaction, as service_role. */
export async function writeRows(db: Queryable, rows: SeedRows): Promise<void> {
  await db.query("set local role service_role");
  const existing = await db.query("select 1 from public.precincts where county_id = $1 limit 1", [rows.countyId]);
  if (existing.rows.length > 0) throw new AlreadySeededError(rows.countyId);

  await db.query(
    `insert into public.precincts (id, county_id, name)
     select * from unnest($1::text[], $2::text[], $3::text[])`,
    [col(rows.precincts, "id"), col(rows.precincts, "county_id"), col(rows.precincts, "name")],
  );
  await db.query(
    `insert into public.machines (id, precinct_id, vendor, model, public_key)
     select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])`,
    [col(rows.machines, "id"), col(rows.machines, "precinct_id"), col(rows.machines, "vendor"), col(rows.machines, "model"), col(rows.machines, "public_key")],
  );
  for (const part of chunks(rows.ballots)) {
    await db.query(
      `insert into private.ballots (id, tracking_code, prev_tracking_code, ciphertext, ciphertext_hash, ballot_style,
                                    precinct_id, machine_id, cast_date, current_status, mismatch)
       select id, tracking_code, prev_tracking_code, ciphertext, ciphertext_hash, ballot_style,
              precinct_id, machine_id, cast_date, 'CAST', false
       from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::date[])
         as t(id, tracking_code, prev_tracking_code, ciphertext, ciphertext_hash, ballot_style, precinct_id, machine_id, cast_date)`,
      [
        col(part, "id"),
        col(part, "tracking_code"),
        col(part, "prev_tracking_code"),
        col(part, "ciphertext"),
        col(part, "ciphertext_hash"),
        col(part, "ballot_style"),
        col(part, "precinct_id"),
        col(part, "machine_id"),
        col(part, "cast_date"),
      ],
    );
  }
  await db.query(
    `insert into public.batches (id, scope, scope_id, from_status, to_status, actor_id, ballot_count)
     select * from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[])`,
    [
      col(rows.batches, "id"),
      col(rows.batches, "scope"),
      col(rows.batches, "scope_id"),
      col(rows.batches, "from_status"),
      col(rows.batches, "to_status"),
      col(rows.batches, "actor_id"),
      col(rows.batches, "ballot_count"),
    ],
  );
  for (const part of chunks(rows.events)) {
    await db.query(
      `insert into private.ballot_events (ballot_id, precinct_id, county_id, event_type, from_status, to_status,
                                          actor_role, actor_id, batch_id, reason, occurred_at, prev_hash, hash)
       select * from unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[],
                            $8::text[], $9::uuid[], $10::text[], $11::timestamptz[], $12::text[], $13::text[])`,
      [
        col(part, "ballot_id"),
        col(part, "precinct_id"),
        col(part, "county_id"),
        col(part, "event_type"),
        col(part, "from_status"),
        col(part, "to_status"),
        col(part, "actor_role"),
        col(part, "actor_id"),
        col(part, "batch_id"),
        col(part, "reason"),
        col(part, "occurred_at"),
        col(part, "prev_hash"),
        col(part, "hash"),
      ],
    );
  }
  for (const part of chunks(rows.statuses)) {
    await db.query(
      `update private.ballots b set current_status = t.current_status, mismatch = t.mismatch
       from unnest($1::uuid[], $2::text[], $3::boolean[]) as t(id, current_status, mismatch)
       where b.id = t.id`,
      [col(part, "id"), col(part, "current_status"), col(part, "mismatch")],
    );
  }
  await db.query(
    `insert into public.stage_records (scope, scope_id, stage, merkle_root, ballot_count, totals, signature)
     select scope, scope_id, stage, merkle_root, ballot_count, totals::jsonb, signature
     from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::int[], $6::text[], $7::text[])
       as t(scope, scope_id, stage, merkle_root, ballot_count, totals, signature)`,
    [
      col(rows.stageRecords, "scope"),
      col(rows.stageRecords, "scope_id"),
      col(rows.stageRecords, "stage"),
      col(rows.stageRecords, "merkle_root"),
      col(rows.stageRecords, "ballot_count"),
      rows.stageRecords.map((r) => JSON.stringify(r.totals)),
      col(rows.stageRecords, "signature"),
    ],
  );
}

export interface SeedConnection extends Queryable {
  connect(): Promise<unknown>;
  end(): Promise<void>;
}

export interface RunSeedDeps {
  /** Defaults to DEFAULT_CRYPTO. Any other adapter (a test fake) may only write to a localhost database. */
  crypto?: CryptoAdapter;
  connect?: (url: string) => SeedConnection;
}

export interface RunSeedInput {
  databaseUrl: string;
  options: PlanOptions;
  env: Readonly<Record<string, string | undefined>>;
}

/**
 * Plans, builds (all crypto, before any connection), then writes in one transaction. With the default
 * adapter before E3 the build throws, so no connection is ever opened.
 */
export async function runSeed(input: RunSeedInput, deps: RunSeedDeps = {}): Promise<SeedRows> {
  const crypto = deps.crypto ?? DEFAULT_CRYPTO;
  // Never write a fake adapter's ciphertexts and tracking codes anywhere but a local scratch database.
  if (crypto !== DEFAULT_CRYPTO) localDatabaseUrl(input.databaseUrl);
  if (!input.databaseUrl) throw new Error("PRODUCT_DATABASE_URL is not set");

  const plan = buildPlan(input.options);
  const rows = await buildRows(plan, crypto, readKeys(input.env));

  const client = (deps.connect ?? ((url) => new pg.Client({ connectionString: url })))(input.databaseUrl);
  await client.connect();
  try {
    await client.query("begin");
    try {
      await writeRows(client, rows);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    await client.end();
  }
  return rows;
}

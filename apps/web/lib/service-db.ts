import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side writes for T-05, as service_role (SUPABASE_SECRET_KEY). Only official routes use it,
// and only after requireRole has passed. Writes go through the four RPCs of
// supabase/migrations/20261107220000_ingest_and_batches.sql (the base tables live in private, out of
// the Data API's reach); the precinct and machine reads use their public tables.
//
// Every RPC returns one jsonb value, so the Data API's max-rows limit cannot cut a result short.

type Env = Readonly<Record<string, string | undefined>>;

/** A Postgres or PostgREST error from an RPC. `code` is the SQLSTATE when there is one. */
export class DbError extends Error {
  readonly code: string | null;
  constructor(code: string | null, message: string) {
    super(message);
    this.name = "DbError";
    this.code = code;
  }
}

export type StoredBallot = {
  ballot_id: string;
  tracking_code: string;
  ciphertext_hash: string;
  current_status: string;
  precinct_id: string;
  county_id: string;
  head_hash: string | null;
  /** Number of chain heads; anything but 1 is a broken chain. */
  heads: number;
};

export type BatchMember = {
  ballot_id: string;
  tracking_code: string;
  /** Standard base64 of the sealed-box bytes. */
  ciphertext: string;
  ciphertext_hash: string;
  precinct_id: string;
  county_id: string;
  head_hash: string | null;
  heads: number;
};

export interface ServiceDb {
  precincts(ids: readonly string[]): Promise<Array<{ id: string; county_id: string }>>;
  machines(ids: readonly string[]): Promise<Array<{ id: string; precinct_id: string }>>;
  chainHeads(codes: readonly string[]): Promise<StoredBallot[]>;
  ingestBallotRecord(file: unknown): Promise<{ file_id: string; event_ids: string[] }>;
  batchMembers(scope: string, scopeId: string, fromStatus: string): Promise<BatchMember[]>;
  applyBatch(batch: unknown): Promise<{ batch_id: string; stage_record_id: string; ballot_count: number }>;
}

function fail(error: { code?: string; message?: string }): never {
  throw new DbError(typeof error.code === "string" && error.code !== "" ? error.code : null, error.message ?? "database error");
}

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) fail(error);
  return data as T;
}

const unique = (values: readonly string[]) => [...new Set(values)];

/** The service_role client, or null when the env is missing (callers answer 500 server_misconfigured). */
export function serviceDb(env: Env = process.env, fetchImpl?: typeof fetch): ServiceDb | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  const client = createClient(url, key, {
    global: { fetch: fetchImpl ?? ((input, init) => globalThis.fetch(input, init)) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    async precincts(ids) {
      const { data, error } = await client.from("precincts").select("id, county_id").in("id", unique(ids)).retry(false);
      if (error) fail(error);
      return (data ?? []) as Array<{ id: string; county_id: string }>;
    },
    async machines(ids) {
      const { data, error } = await client.from("machines").select("id, precinct_id").in("id", unique(ids)).retry(false);
      if (error) fail(error);
      return (data ?? []) as Array<{ id: string; precinct_id: string }>;
    },
    chainHeads: (codes) => rpc(client, "chain_heads", { p_codes: codes }),
    ingestBallotRecord: (file) => rpc(client, "ingest_ballot_record", { p_file: file }),
    batchMembers: (scope, scopeId, fromStatus) =>
      rpc(client, "batch_members", { p_scope: scope, p_scope_id: scopeId, p_from_status: fromStatus }),
    applyBatch: (batch) => rpc(client, "apply_batch", { p_batch: batch }),
  };
}

const NO_STORE = { "cache-control": "no-store" };

export function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** 500 for a missing or invalid server secret. Nothing has been written. */
export function serverMisconfigured(): Response {
  return jsonResponse(500, { error: "server_misconfigured" });
}

// Raised by the RPCs: VB409 when the data changed between the read and the write (the call rolled
// back; retry), VB422 when the payload breaks a rule. 23505 (unique) and serialization or deadlock
// failures are conflicts too.
const CONFLICT_CODES = new Set(["VB409", "23505", "40001", "40P01"]);

/**
 * The response for a failed RPC. Messages of our own VB errors are safe to return; anything else
 * gets a generic body so database details never reach the client.
 */
export function dbFailure(error: unknown): Response {
  const code = error instanceof DbError ? error.code : null;
  if (code === "VB409") return jsonResponse(409, { error: "conflict", message: (error as DbError).message });
  if (code !== null && CONFLICT_CODES.has(code)) return jsonResponse(409, { error: "conflict" });
  if (code === "VB422") return jsonResponse(422, { error: (error as DbError).message, code: "REJECTED" });
  return jsonResponse(500, { error: "internal_error" });
}

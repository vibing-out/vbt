import type pg from "pg";
import { afterAll, beforeAll, describe } from "vitest";
import { createScratchDatabase, localDatabaseUrl } from "../lib/db.ts";

const url = process.env.DATABASE_URL;
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL must be set in CI: the database tests may not be skipped there.");
}
if (!url) {
  console.warn("DATABASE_URL is not set: skipping the supabase database tests (CI always runs them).");
}

/** describe() when a local database is available, describe.skip() otherwise (never in CI). */
export const describeDb = url ? describe : describe.skip;

export type Role = "anon" | "authenticated" | "service_role" | "postgres";

/** One fresh database (all migrations applied, optionally the seed) for the calling test file. */
export function useScratchDatabase(options: { seed?: boolean } = {}): () => pg.Client {
  let db: Awaited<ReturnType<typeof createScratchDatabase>> | undefined;
  beforeAll(async () => {
    db = await createScratchDatabase(localDatabaseUrl(url), options);
  });
  afterAll(async () => {
    await db?.close();
  });
  return () => {
    if (!db) throw new Error("scratch database not ready");
    return db.client;
  };
}

/**
 * Runs SQL as one of Supabase's roles inside a transaction that is always rolled back, so tests never
 * change the shared scratch database. "postgres" stays the connecting (owner) role. Steps may switch
 * role themselves with `set local role ...`. Returns the last step's result.
 */
export async function asRoleSteps(
  client: pg.Client,
  role: Role,
  steps: Array<{ sql: string; params?: unknown[] }>,
): Promise<pg.QueryResult> {
  await client.query("begin");
  try {
    if (role !== "postgres") await client.query(`set local role ${role}`);
    let last: pg.QueryResult | undefined;
    for (const step of steps) last = await client.query(step.sql, step.params ?? []);
    if (!last) throw new Error("no steps");
    return last;
  } finally {
    await client.query("rollback");
  }
}

export function asRole(
  client: pg.Client,
  role: Role,
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult> {
  return asRoleSteps(client, role, [{ sql, params }]);
}

/**
 * A step that sets the request's JWT claims for the rest of the transaction, as PostgREST does for each
 * request, so auth.uid() and auth.jwt() (and the RLS policies that use them) see these claims.
 */
export function withClaims(claims: Record<string, unknown>): { sql: string; params: unknown[] } {
  return { sql: "select set_config('request.jwt.claims', $1, true)", params: [JSON.stringify(claims)] };
}

export const PERMISSION_DENIED = /permission denied/;
export const INSERT_ONLY = /is insert-only/;

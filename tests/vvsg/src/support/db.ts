// Scratch-database helpers for the VVSG database tests. Only createScratchDatabase and localDatabaseUrl
// come from @vbt/supabase; the skip rule copies supabase/tests/support.ts so nothing under supabase/
// changes: CI must run these tests, a laptop without a local Postgres skips them.
import type pg from "pg";
import { afterAll, beforeAll, describe } from "vitest";
import { createScratchDatabase, localDatabaseUrl } from "@vbt/supabase/lib/db.ts";

const url = process.env.DATABASE_URL;
if (!url && process.env.CI) {
  throw new Error("DATABASE_URL must be set in CI: the VVSG database tests may not be skipped there.");
}
if (!url) {
  console.warn("DATABASE_URL is not set: skipping the VVSG database tests (CI always runs them).");
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

/** Runs one query as a Supabase role inside a transaction that is always rolled back. */
export async function asRole(
  client: pg.Client,
  role: Role,
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult> {
  await client.query("begin");
  try {
    if (role !== "postgres") await client.query(`set local role ${role}`);
    return await client.query(sql, params);
  } finally {
    await client.query("rollback");
  }
}

// Test-only: a fresh local database per test file (all migrations, no seed), dropped afterwards.
// Same rule as supabase/tests/support.ts: skipped without DATABASE_URL locally, never skipped in CI.

import { createScratchDatabase, localDatabaseUrl } from "@vbt/supabase/lib/db.ts";
import type pg from "pg";
import { afterAll, beforeAll, describe } from "vitest";

const url = process.env.DATABASE_URL;
if (!url && process.env.CI) throw new Error("DATABASE_URL must be set in CI: the database tests may not be skipped there.");

/** describe() when a local database is available, describe.skip() otherwise (never in CI). */
export const describeDb = url ? describe : describe.skip;

export interface Scratch {
  client: pg.Client;
  /** A connection string to the scratch database itself (localhost). */
  url: string;
}

export function useScratchDatabase(): () => Scratch {
  let db: Awaited<ReturnType<typeof createScratchDatabase>> | undefined;
  let scratchUrl = "";
  beforeAll(async () => {
    db = await createScratchDatabase(localDatabaseUrl(url));
    const { rows } = await db.client.query<{ name: string }>("select current_database() as name");
    const u = new URL(url!);
    u.pathname = `/${rows[0]!.name}`;
    scratchUrl = u.toString();
  });
  afterAll(async () => {
    await db?.close();
  });
  return () => {
    if (!db) throw new Error("scratch database not ready");
    return { client: db.client, url: scratchUrl };
  };
}

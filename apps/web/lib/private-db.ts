import "server-only";

import pg from "pg";

// A direct Postgres connection to the product database, for server code that must read the private
// schema (private.ballots, private.ballot_events are not in the Data API: 20261107200000). Read-only
// transactions as service_role only. PRODUCT_DATABASE_URL is server-only: never NEXT_PUBLIC_.

type Env = Readonly<Record<string, string | undefined>>;

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

let pool: { url: string; pool: pg.Pool } | undefined;

function poolFor(url: string): pg.Pool {
  if (pool?.url !== url) {
    void pool?.pool.end().catch(() => undefined);
    // A serverless function serves one request at a time: keep the pool small.
    const created = new pg.Pool({ connectionString: url, max: 2, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });
    // An idle connection dropped by the server must not crash the process; the next query reconnects.
    created.on("error", () => undefined);
    pool = { url, pool: created };
  }
  return pool.pool;
}

/** Closes the pool (tests, shutdown). */
export async function closePrivateDb(): Promise<void> {
  const current = pool;
  pool = undefined;
  await current?.pool.end();
}

/**
 * Runs `fn` inside `begin read only; set local role service_role`, then rolls back (nothing is ever
 * written). Throws when PRODUCT_DATABASE_URL is missing or the database fails; callers answer 503.
 */
export async function withServiceRoleReadOnly<T>(fn: (db: Queryable) => Promise<T>, env: Env = process.env): Promise<T> {
  const url = env.PRODUCT_DATABASE_URL;
  if (!url) throw new Error("PRODUCT_DATABASE_URL is not set");
  const client = await poolFor(url).connect();
  let broken = false;
  try {
    await client.query("begin read only");
    await client.query("set local role service_role");
    return await fn(client);
  } finally {
    // A connection whose rollback fails is discarded, not returned to the pool.
    await client.query("rollback").catch(() => (broken = true));
    client.release(broken);
  }
}

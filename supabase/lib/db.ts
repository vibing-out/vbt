// Applies supabase/migrations (and optionally seed.sql) to a plain Postgres, the way CI and the DB tests
// need it. Production never goes through here: it gets migrations only, from `supabase db push` in CI.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

export const SUPABASE_DIR = join(import.meta.dirname, "..");
export const MIGRATIONS_DIR = join(SUPABASE_DIR, "migrations");
export const SEED_FILE = join(SUPABASE_DIR, "seed.sql");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Refuses anything but a local database, so a test run can never create or drop databases elsewhere. */
export function localDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error("DATABASE_URL is not set (a local Postgres, for example from `supabase start`).");
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`DATABASE_URL must point at a local Postgres (localhost), not ${host}.`);
  }
  return url;
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * Plain Postgres lacks Supabase's API roles. Create anon, authenticated and service_role when missing
 * and copy Supabase's default privileges (everything granted to all three), so the migrations' revokes
 * are tested against the same starting point as production. A real Supabase database is left alone.
 */
export async function bootstrapSupabaseRoles(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ supabase: boolean }>(
    "select exists (select 1 from pg_roles where rolname = 'supabase_admin') as supabase",
  );
  if (rows[0]?.supabase) return;

  await client.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin noinherit bypassrls;
      end if;
    end
    $$;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  `);
}

async function runFile(client: pg.Client, path: string): Promise<void> {
  const sql = readFileSync(path, "utf8");
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw new Error(`${path}: ${(error as Error).message}`, { cause: error });
  }
}

export async function applyMigrations(client: pg.Client): Promise<string[]> {
  const files = migrationFiles();
  for (const file of files) await runFile(client, join(MIGRATIONS_DIR, file));
  return files;
}

export async function applySeed(client: pg.Client): Promise<void> {
  await runFile(client, SEED_FILE);
}

/** A fresh, empty database on the local server, dropped again by close(). */
export async function createScratchDatabase(
  adminUrl: string,
  options: { seed?: boolean } = {},
): Promise<{ client: pg.Client; close: () => Promise<void> }> {
  const name = `vbt_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  await bootstrapSupabaseRoles(client);
  await applyMigrations(client);
  if (options.seed) await applySeed(client);

  return {
    client,
    close: async () => {
      await client.end();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}

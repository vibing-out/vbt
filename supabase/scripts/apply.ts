// Applies every migration (and seed.sql with --seed) to the local Postgres in DATABASE_URL.
// CI runs it against an empty database to prove the migrations apply cleanly.
// Usage: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres node scripts/apply.ts [--seed]
import pg from "pg";
import { applyMigrations, applySeed, bootstrapSupabaseRoles, localDatabaseUrl } from "../lib/db.ts";

const client = new pg.Client({ connectionString: localDatabaseUrl(process.env.DATABASE_URL) });
await client.connect();
try {
  await bootstrapSupabaseRoles(client);
  for (const file of await applyMigrations(client)) console.log(`applied ${file}`);
  if (process.argv.includes("--seed")) {
    await applySeed(client);
    console.log("applied seed.sql");
  }
} finally {
  await client.end();
}

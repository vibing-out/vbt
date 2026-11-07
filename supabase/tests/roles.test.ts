import pg from "pg";
import { expect, test } from "vitest";
import { ensureRoles, localDatabaseUrl } from "../lib/db.ts";
import { describeDb } from "./support.ts";

async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: localDatabaseUrl(process.env.DATABASE_URL) });
  await client.connect();
  return client;
}

describeDb("role bootstrap", () => {
  test("a role created by another session mid-bootstrap is not an error", async () => {
    const name = `vbt_race_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const role = [{ name, options: "nologin" }];
    const [first, second] = [await connect(), await connect()];
    try {
      // first creates the role but has not committed: second's existence check misses it, its create
      // blocks on pg_authid, and fails with a duplicate once first commits. That is the parallel-file race.
      await first.query("begin");
      await ensureRoles(first, role);
      const racing = ensureRoles(second, role);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await first.query("commit");
      await expect(racing).resolves.toBeUndefined();

      const { rows } = await second.query("select count(*)::int as n from pg_roles where rolname = $1", [name]);
      expect(rows[0]).toEqual({ n: 1 });
    } finally {
      await first.query("rollback").catch(() => undefined);
      await first.query(`drop role if exists ${name}`);
      await Promise.all([first.end(), second.end()]);
    }
  });

  test("many sessions ensuring the same roles at once all succeed", async () => {
    const name = `vbt_race_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const clients = await Promise.all(Array.from({ length: 6 }, connect));
    try {
      await Promise.all(clients.map((client) => ensureRoles(client, [{ name, options: "nologin" }])));
    } finally {
      await clients[0]?.query(`drop role if exists ${name}`);
      await Promise.all(clients.map((client) => client.end()));
    }
  });

  test("rejects unsafe role names", async () => {
    const client = await connect();
    try {
      await expect(ensureRoles(client, [{ name: "x; drop table y", options: "" }])).rejects.toThrow(/unsafe/);
    } finally {
      await client.end();
    }
  });
});

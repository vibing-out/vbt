import { expect, test } from "vitest";
import { FAKE_KEY_ENV, fakeCrypto } from "./testing/fake-crypto.ts";
import { runSeed, type SeedConnection } from "./write.ts";

const OPTIONS = { ballots: 20, precincts: 2, rate: 0.1, seed: "write-test" };

/** A connection that records statements and can fail on one. */
function recorder(failOn?: RegExp) {
  const sql: string[] = [];
  const client: SeedConnection = {
    connect: async () => undefined,
    end: async () => {
      sql.push("<end>");
    },
    query: async (text: string) => {
      sql.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
      if (failOn?.test(text)) throw new Error("boom");
      return { rows: [] };
    },
  };
  return { sql, client };
}

test("AC7: a fake adapter is refused for a database that is not on localhost, before connecting", async () => {
  let connected = false;
  const connect = () => {
    connected = true;
    return recorder().client;
  };
  for (const databaseUrl of ["postgresql://postgres:pw@db.example.supabase.co:5432/postgres", ""]) {
    await expect(runSeed({ databaseUrl, options: OPTIONS, env: FAKE_KEY_ENV }, { crypto: fakeCrypto(), connect })).rejects.toThrow(
      /DATABASE_URL/,
    );
  }
  expect(connected).toBe(false);
});

test("AC5: with the real adapter, keys that cannot encrypt stop the build before any connection is opened", async () => {
  let connected = false;
  await expect(
    runSeed({ databaseUrl: "postgresql://x@db.example.com/postgres", options: OPTIONS, env: FAKE_KEY_ENV }, {
      connect: () => {
        connected = true;
        return recorder().client;
      },
    }),
  ).rejects.toThrow();
  expect(connected).toBe(false);
});

test("the write is one transaction as service_role, committed, then the connection closes", async () => {
  const { sql, client } = recorder();
  await runSeed({ databaseUrl: "postgresql://postgres@localhost/x", options: OPTIONS, env: FAKE_KEY_ENV }, { crypto: fakeCrypto(), connect: () => client });
  expect(sql.slice(0, 3)).toEqual(["begin", "set local role", "select 1 from"]);
  expect(sql.slice(-2)).toEqual(["commit", "<end>"]);
  // Ballots: inserted, then only current_status and mismatch updated. No update/delete on insert-only tables.
  expect(sql.filter((s) => s.startsWith("update"))).toEqual(["update private.ballots b"]);
  expect(sql.some((s) => /^(delete|truncate)/.test(s))).toBe(false);
});

test("any failure rolls the whole transaction back and still closes the connection", async () => {
  const { sql, client } = recorder(/insert into public\.stage_records/);
  await expect(
    runSeed({ databaseUrl: "postgresql://postgres@localhost/x", options: OPTIONS, env: FAKE_KEY_ENV }, { crypto: fakeCrypto(), connect: () => client }),
  ).rejects.toThrow("boom");
  expect(sql.slice(-2)).toEqual(["rollback", "<end>"]);
  expect(sql).not.toContain("commit");
});

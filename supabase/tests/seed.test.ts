import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { migrationFiles, SUPABASE_DIR } from "../lib/db.ts";
import { describeDb, useScratchDatabase } from "./support.ts";

const ci = readFileSync(join(SUPABASE_DIR, "..", ".github", "workflows", "ci.yml"), "utf8");
const job = (name: string) => {
  const start = ci.indexOf(`\n  ${name}:\n`);
  expect(start).toBeGreaterThan(-1);
  const next = ci.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next === -1 ? ci.slice(start) : ci.slice(start, start + 1 + next);
};

describeDb("dev seed", () => {
  const db = useScratchDatabase({ seed: true });

  test("has exactly 3 precincts and 50 ballots", async () => {
    const { rows } = await db().query(
      "select (select count(*)::int from precincts) as precincts, (select count(*)::int from ballots) as ballots",
    );
    expect(rows[0]).toEqual({ precincts: 3, ballots: 50 });
  });

  test("spreads the ballots over every precinct, each on its precinct's machine", async () => {
    const { rows } = await db().query(
      `select b.precinct_id, count(*)::int as n from ballots b
       join machines m on m.id = b.machine_id and m.precinct_id = b.precinct_id
       group by 1 order by 1`,
    );
    expect(rows).toEqual([
      { precinct_id: "18057-001", n: 16 },
      { precinct_id: "18097-001", n: 17 },
      { precinct_id: "18097-002", n: 17 },
    ]);
  });

  test("gives every ballot a CAST event and a matching ciphertext hash", async () => {
    const { rows } = await db().query(
      `select
         (select count(*)::int from ballots b where exists
            (select 1 from ballot_events e where e.ballot_id = b.id and e.event_type = 'CAST')) as with_cast,
         (select count(*)::int from ballots
            where ciphertext_hash = encode(sha256(convert_to(ciphertext, 'UTF8')), 'hex')) as hash_ok`,
    );
    expect(rows[0]).toEqual({ with_cast: 50, hash_ok: 50 });
  });

  test("chains tracking codes per machine", async () => {
    const { rows } = await db().query(
      `select count(*)::int as broken from ballots b
       where b.prev_tracking_code is not null and not exists
         (select 1 from ballots p where p.tracking_code = b.prev_tracking_code and p.machine_id = b.machine_id)`,
    );
    expect(rows[0]).toEqual({ broken: 0 });
  });
});

test("the seed is not a migration, so `supabase db push` never applies it", () => {
  expect(migrationFiles().some((file) => file.includes("seed"))).toBe(false);
  const migrate = job("migrate");
  expect(migrate).toMatch(/supabase db push/);
  expect(migrate).not.toMatch(/include-seed/);
});

test("local `supabase db reset` loads the seed", () => {
  const config = readFileSync(join(SUPABASE_DIR, "config.toml"), "utf8");
  expect(config).toMatch(/\[db\.seed\][^[]*sql_paths = \["\.\/seed\.sql"\]/);
});

test("the CI check job runs the database tests against a Postgres service", () => {
  const check = job("check");
  expect(check).toMatch(/timeout-minutes: 5/);
  expect(check).toMatch(/services:\s+postgres:/);
  expect(check).toMatch(/DATABASE_URL: postgresql:\/\/postgres:postgres@localhost:5432\/postgres/);
  const apply = check.indexOf("pnpm --filter @vbt/supabase db:apply");
  expect(apply).toBeGreaterThan(-1);
  expect(apply).toBeLessThan(check.indexOf("run: pnpm test"));
});

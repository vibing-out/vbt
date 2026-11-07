// VVSG 2.0 ballot secrecy, database surface (T-19). Runs against a scratch database with every
// migration and the seed applied. Endpoint, export, receipt and log secrecy arrive with later tickets;
// docs/vvsg-map.md names them.
import { expect, test } from "vitest";
import { describeDb, useScratchDatabase } from "./support/db.ts";
import { isIdentityName } from "./support/identity.ts";

const SCHEMAS = ["public", "private"];
const PUBLIC_ROLES = ["anon", "authenticated"] as const;

/**
 * Columns whose name has an identity token but holds no voter identity, each with its reason.
 * T-18 adds sms_subscriptions.phone_encrypted with its own reason when it lands.
 */
const IDENTITY_EXCEPTIONS: Record<string, string> = {
  "precincts.name": "the name of a precinct, a public place, not of a voter",
  "stage_records.signature": "the officials' cryptographic signature over a published stage record",
};

/** "table.column" names that look like voter identity and aren't excepted. */
function identityColumns(columns: readonly string[]): string[] {
  return columns.filter((col) => {
    const column = col.slice(col.indexOf(".") + 1);
    return isIdentityName(column) && !(col in IDENTITY_EXCEPTIONS);
  });
}

test("the identity check flags voter_name, date_of_birth and phone, and passes the exceptions", () => {
  expect(
    identityColumns(["ballots.voter_name", "ballots.date_of_birth", "subscribers.phone", "ballots.tracking_code"]),
  ).toEqual(["ballots.voter_name", "ballots.date_of_birth", "subscribers.phone"]);
  expect(identityColumns(Object.keys(IDENTITY_EXCEPTIONS))).toEqual([]);
});

describeDb("ballot secrecy: the database surface", () => {
  const db = useScratchDatabase({ seed: true });

  test("no table or view column holds voter identity", async () => {
    const { rows } = await db().query<{ col: string }>(
      `select c.relname || '.' || a.attname as col
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'f')
         and a.attnum > 0 and not a.attisdropped
       order by 1`,
      [SCHEMAS],
    );
    const columns = rows.map((r) => r.col);
    expect(columns).toContain("ballots.tracking_code");
    expect(identityColumns(columns)).toEqual([]);
    // A stale exception (the column was renamed or dropped) fails too, so the list stays honest.
    expect(Object.keys(IDENTITY_EXCEPTIONS).filter((col) => !columns.includes(col))).toEqual([]);
  });

  test("every table has row-level security, every view is security_invoker, no materialized view", async () => {
    const { rows } = await db().query<{ name: string; relkind: string; rls: boolean; options: string[] | null }>(
      `select n.nspname || '.' || c.relname as name, c.relkind::text as relkind,
              c.relrowsecurity as rls, c.reloptions as options
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm')
       order by 1`,
      [SCHEMAS],
    );
    const tables = rows.filter((r) => r.relkind === "r" || r.relkind === "p");
    const views = rows.filter((r) => r.relkind === "v");
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(["private.ballots", "private.ballot_events"]));
    expect(views.map((v) => v.name)).toEqual(expect.arrayContaining(["public.ballot_public", "public.ballot_event_public"]));

    expect(tables.filter((t) => !t.rls).map((t) => t.name)).toEqual([]);
    const invoker = (options: string[] | null) =>
      (options ?? []).some((o) => /^security_invoker=(true|on|1|yes)$/i.test(o));
    expect(views.filter((v) => !invoker(v.options)).map((v) => v.name)).toEqual([]);
    expect(rows.filter((r) => r.relkind === "m").map((r) => r.name)).toEqual([]);
  });

  test.each(PUBLIC_ROLES)("%s holds no write privilege on any relation, table- or column-level", async (role) => {
    const { rows } = await db().query<{ name: string; privilege: string }>(
      `select n.nspname || '.' || c.relname as name, p.privilege
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(privilege)
       where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'f')
         and (has_table_privilege($2, c.oid, p.privilege)
              or (p.privilege in ('INSERT', 'UPDATE') and has_any_column_privilege($2, c.oid, p.privilege)))
       order by 1, 2`,
      [SCHEMAS, role],
    );
    expect(rows).toEqual([]);
  });

  test.each(PUBLIC_ROLES)(
    "%s can read no time, timestamp or interval next to a tracking code or ballot id",
    async (role) => {
      const { rows } = await db().query<{ relation: string; col: string; type: string }>(
        `with readable as (
           select n.nspname || '.' || c.relname as relation, a.attname as col,
                  format_type(a.atttypid, a.atttypmod) as type
           from pg_attribute a
           join pg_class c on c.oid = a.attrelid
           join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = any($1) and c.relkind in ('r', 'p', 'v', 'm', 'f')
             and a.attnum > 0 and not a.attisdropped
             and has_column_privilege($2, c.oid, a.attnum, 'SELECT')
         )
         select relation, col, type from readable
         where relation in (select relation from readable where col in ('tracking_code', 'ballot_id'))
         order by 1, 2`,
        [SCHEMAS, role],
      );
      // The public tracker reads tracking codes, so the check is not vacuous.
      expect(rows.some((r) => r.col === "tracking_code")).toBe(true);
      expect(rows.filter((r) => /\b(time|timestamp|interval)\b/.test(r.type))).toEqual([]);
    },
  );

  test("ballot_event_public.occurred_on is a date", async () => {
    const { rows } = await db().query<{ type: string }>(
      `select format_type(a.atttypid, a.atttypmod) as type
       from pg_attribute a where a.attrelid = 'public.ballot_event_public'::regclass and a.attname = 'occurred_on'`,
    );
    expect(rows).toEqual([{ type: "date" }]);
  });
});

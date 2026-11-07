// T-04 follow-up (#12): one block per review resolution this follow-up changes (1, 2, 3 and 8).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { SUPABASE_DIR } from "../lib/db.ts";
import { asRole, asRoleSteps, describeDb, PERMISSION_DENIED, useScratchDatabase } from "./support.ts";

const PUBLIC_ROLES = ["anon", "authenticated"] as const;
const PUBLIC_VIEWS = ["ballot_event_public", "ballot_public"];
const BASE_TABLES = ["ballot_events", "ballots"];
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const sorted = (values: string[]) => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
// The seed inserts SEED-0001 .. SEED-0050 in this order, so this is the cast (insertion) order.
const CAST_ORDER = Array.from({ length: 50 }, (_, i) => `SEED-${String(i + 1).padStart(4, "0")}`);

describeDb("resolution 1: nothing the public reads reveals cast order", () => {
  const db = useScratchDatabase({ seed: true });

  /**
   * Every column anon may select, with its type and default: in public, and in private, where the
   * security_invoker views read through anon's own column grants.
   */
  async function publicColumns() {
    const { rows } = await db().query<{ col: string; data_type: string; column_default: string | null; is_identity: string }>(
      `select table_name || '.' || column_name as col, data_type, column_default, is_identity
       from information_schema.columns
       where table_schema in ('public', 'private')
         and has_column_privilege('anon', format('%I.%I', table_schema, table_name), column_name, 'SELECT')
       order by 1`,
    );
    expect(rows.length).toBeGreaterThan(0);
    return rows;
  }

  test("no public-readable column is a sequence or identity, and the schema has no sequences", async () => {
    const columns = await publicColumns();
    expect(columns.filter((c) => c.is_identity === "YES" || /nextval/.test(c.column_default ?? ""))).toEqual([]);
    const { rows } = await db().query(
      "select sequence_name from information_schema.sequences where sequence_schema in ('public', 'private')",
    );
    expect(rows).toEqual([]);
  });

  test("every uuid key defaults to gen_random_uuid() (random v4, not time-ordered)", async () => {
    const { rows } = await db().query<{ col: string; column_default: string | null }>(
      `select table_name || '.' || column_name as col, column_default from information_schema.columns
       where table_schema in ('public', 'private') and data_type = 'uuid' and column_default is not null order by 1`,
    );
    expect(rows.map((r) => r.col)).toEqual(
      expect.arrayContaining(["ballot_events.id", "ballots.id", "batches.id", "stage_records.id"]),
    );
    expect(rows.filter((r) => r.column_default !== "gen_random_uuid()")).toEqual([]);
  });

  test("the only public-readable timestamp is a stage record's publication time, never a cast or event time", async () => {
    const columns = await publicColumns();
    // stage_records.published_at: when an aggregate record was published, set per batch, not per ballot.
    expect(columns.filter((c) => /time|interval/.test(c.data_type)).map((c) => c.col)).toEqual([
      "stage_records.published_at",
    ]);
  });

  for (const role of PUBLIC_ROLES) {
    test(`${role}: ballot_public comes back ordered by ciphertext hash, not in cast order`, async () => {
      const { rows } = await asRole(db(), role, "select tracking_code, ciphertext_hash from ballot_public");
      const hashes = rows.map((r: { ciphertext_hash: string }) => r.ciphertext_hash);
      expect(hashes).toEqual(sorted(hashes));
      const codes = rows.map((r: { tracking_code: string }) => r.tracking_code);
      expect(sorted(codes)).toEqual(CAST_ORDER);
      expect(codes).not.toEqual(CAST_ORDER);
    });

    test(`${role}: ballot_event_public comes back ordered by event hash, not in cast order`, async () => {
      const { rows } = await asRole(
        db(),
        role,
        `select e.hash, b.tracking_code from ballot_event_public e join ballot_public b on b.id = e.ballot_id`,
      );
      // The join may reorder, so check the view's own order separately below.
      expect(rows).toHaveLength(50);
      const own = await asRole(db(), role, "select hash from ballot_event_public");
      const hashes = own.rows.map((r: { hash: string }) => r.hash);
      expect(hashes).toEqual(sorted(hashes));
      const byHash = new Map(rows.map((r: { hash: string; tracking_code: string }) => [r.hash, r.tracking_code]));
      expect(hashes.map((h) => byHash.get(h))).not.toEqual(CAST_ORDER);
    });
  }
});

describeDb("resolution 1: public roles reach only the views in public, never the base tables", () => {
  const db = useScratchDatabase({ seed: true });

  /** The schemas supabase/config.toml exposes through the Data API ([api] schemas). */
  function exposedSchemas(): string[] {
    const config = readFileSync(join(SUPABASE_DIR, "config.toml"), "utf8");
    const api = config.match(/^\[api\]\n([\s\S]*?)(?=^\[)/m)?.[1] ?? "";
    const list = api.match(/^schemas\s*=\s*\[([^\]]*)\]/m)?.[1];
    expect(list, "supabase/config.toml must pin [api] schemas").toBeDefined();
    return [...list!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).sort();
  }

  test("the Data API exposes public and graphql_public only, never private", () => {
    expect(exposedSchemas()).toEqual(["graphql_public", "public"]);
  });

  test("ballots and ballot_events live in private, and no exposed schema has a relation by those names", async () => {
    const { rows } = await db().query<{ schema: string; name: string }>(
      `select n.nspname as schema, c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relname = any($1) order by 1, 2`,
      [BASE_TABLES],
    );
    expect(rows).toEqual(BASE_TABLES.map((name) => ({ schema: "private", name })));
    expect(rows.filter((r) => exposedSchemas().includes(r.schema))).toEqual([]);
  });

  for (const role of PUBLIC_ROLES) {
    test(`${role}: what it can read in the exposed schemas is the views and the non-ballot tables`, async () => {
      const { rows } = await db().query<{ name: string; kind: string }>(
        `select c.relname as name, c.relkind::text as kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = any($2) and c.relkind in ('r', 'p', 'v', 'm', 'f')
           and (has_table_privilege($1, c.oid, 'SELECT')
                or exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attnum > 0
                           and not a.attisdropped and has_column_privilege($1, c.oid, a.attnum, 'SELECT')))
         order by 1`,
        [role, exposedSchemas()],
      );
      expect(rows).toEqual([
        { name: "app_info", kind: "r" },
        { name: "ballot_event_public", kind: "v" },
        { name: "ballot_public", kind: "v" },
        { name: "machines", kind: "r" },
        { name: "precincts", kind: "r" },
        { name: "stage_records", kind: "r" },
      ]);
    });

    // What a Data API request for /ballots or /ballot_events resolves to: the role's default search path.
    test.each(["select tracking_code from ballots", "select hash from ballot_events", "select id from public.ballots"])(
      `${role}: %s finds no such relation`,
      async (sql) => {
        await expect(asRole(db(), role, sql)).rejects.toThrow(/does not exist/);
      },
    );

    test(`${role} can use private but not create in it`, async () => {
      const { rows } = await db().query(
        `select has_schema_privilege($1, 'private', 'USAGE') as usage, has_schema_privilege($1, 'private', 'CREATE') as create`,
        [role],
      );
      expect(rows).toEqual([{ usage: true, create: false }]);
    });

    // The security_invoker views need these grants (resolution 2); nothing in private beyond them.
    test(`${role}'s grants in private are exactly the columns the public views show`, async () => {
      const { rows } = await db().query<{ col: string }>(
        `select table_name || '.' || column_name as col from information_schema.columns
         where table_schema = 'private'
           and has_column_privilege($1, format('%I.%I', table_schema, table_name), column_name, 'SELECT')
         order by 1`,
        [role],
      );
      const { rows: viewColumns } = await db().query<{ col: string }>(
        `select vcu.table_name || '.' || vcu.column_name as col from information_schema.view_column_usage vcu
         where vcu.view_schema = 'public' and vcu.view_name = any($1) and vcu.table_schema = 'private'
         order by 1`,
        [PUBLIC_VIEWS],
      );
      expect(viewColumns.length).toBeGreaterThan(0);
      expect(rows.map((r) => r.col)).toEqual(viewColumns.map((r) => r.col));
      expect(rows.map((r) => r.col)).not.toEqual(expect.arrayContaining(["ballots.ciphertext"]));
      const { rows: writes } = await db().query(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'private' and (has_table_privilege($1, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')
                                         or has_any_column_privilege($1, c.oid, 'INSERT, UPDATE'))`,
        [role],
      );
      expect(writes).toEqual([]);
    });

    test(`${role} still reads every ballot and event through the views`, async () => {
      const ballots = await asRole(db(), role, "select tracking_code from ballot_public");
      const events = await asRole(db(), role, "select hash from ballot_event_public");
      expect([ballots.rowCount, events.rowCount]).toEqual([50, 50]);
    });
  }
});

describeDb("resolution 2: the public views run as the caller", () => {
  const db = useScratchDatabase({ seed: true });

  test.each(PUBLIC_VIEWS)("%s is security_invoker and security_barrier", async (view) => {
    const { rows } = await db().query<{ options: string[] }>(
      `select c.reloptions as options from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1 and c.relkind = 'v'`,
      [view],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.options).toEqual(expect.arrayContaining(["security_invoker=true", "security_barrier=true"]));
  });

  test("ballot_event_public uses the caller's column grants: without occurred_on, anon is refused", async () => {
    await expect(
      asRoleSteps(db(), "postgres", [
        { sql: "revoke select (occurred_on) on private.ballot_events from anon" },
        { sql: "set local role anon" },
        { sql: "select occurred_on from ballot_event_public" },
      ]),
    ).rejects.toThrow(PERMISSION_DENIED);
  });

  test("ballot_event_public applies the caller's RLS: without the public policy, anon sees no rows", async () => {
    const { rowCount } = await asRoleSteps(db(), "postgres", [
      { sql: "drop policy ballot_events_public_read on private.ballot_events" },
      { sql: "set local role anon" },
      { sql: "select id from ballot_event_public" },
    ]);
    expect(rowCount).toBe(0);
  });

  for (const role of PUBLIC_ROLES) {
    // The grants the security_invoker view needs: the date and the hashes, never a time.
    test(`${role} holds column grants on private.ballot_events for the date and hashes, and no time`, async () => {
      const { rows } = await db().query<{ column_name: string; granted: boolean }>(
        `select column_name, has_column_privilege($1, 'private.ballot_events', column_name, 'SELECT') as granted
         from information_schema.columns
         where table_schema = 'private' and table_name = 'ballot_events'
           and column_name in ('occurred_on', 'prev_hash', 'hash', 'occurred_at', 'recorded_at') order by 1`,
        [role],
      );
      expect(rows).toEqual([
        { column_name: "hash", granted: true },
        { column_name: "occurred_at", granted: false },
        { column_name: "occurred_on", granted: true },
        { column_name: "prev_hash", granted: true },
        { column_name: "recorded_at", granted: false },
      ]);
      const { rows: dated } = await asRole(
        db(),
        role,
        "select count(*)::int as n from ballot_event_public where occurred_on = date '2026-11-03' and hash is not null",
      );
      expect(dated[0]).toEqual({ n: 50 });
    });
  }

  test("the event date is derived from occurred_at and cannot be written directly", async () => {
    await expect(
      asRole(
        db(),
        "service_role",
        `insert into private.ballot_events (ballot_id, precinct_id, county_id, event_type, actor_role, actor_id,
                                    occurred_at, occurred_on, hash)
         select id, precinct_id, '18097', 'MISMATCH_DETECTED', 'county', 'c-1', now(), date '2000-01-01', 'h'
         from private.ballots where tracking_code = 'SEED-0001'`,
      ),
    ).rejects.toThrow(/occurred_on/);
  });
});

describeDb("resolution 3: anyone can recompute the hash chain", () => {
  const db = useScratchDatabase({ seed: true });

  for (const role of PUBLIC_ROLES) {
    test(`${role} recomputes every seeded CAST event hash from public data`, async () => {
      const { rows } = await asRole(
        db(),
        role,
        `select b.tracking_code, e.prev_hash, e.hash
         from ballot_event_public e join ballot_public b on b.id = e.ballot_id
         where e.event_type = 'CAST'`,
      );
      expect(rows).toHaveLength(50);
      for (const row of rows as Array<{ tracking_code: string; prev_hash: string | null; hash: string }>) {
        expect(row.prev_hash).toBeNull();
        expect(row.hash).toBe(sha256(`CAST:${row.tracking_code}`));
      }
    });

    test(`${role} follows a ballot's chain: each event's prev_hash is the previous event's hash`, async () => {
      const castHash = sha256("CAST:SEED-0001");
      const nextHash = sha256(`${castHash}:STATUS_CHANGE:CAST:TALLIED_PRECINCT:2026-11-03`);
      const { rows } = await asRoleSteps(db(), "service_role", [
        {
          sql: `insert into private.ballot_events (ballot_id, precinct_id, county_id, event_type, from_status, to_status,
                                           actor_role, actor_id, occurred_at, prev_hash, hash)
                select id, precinct_id, '18097', 'STATUS_CHANGE', 'CAST', 'TALLIED_PRECINCT', 'poll_worker', 'pw-1',
                       timestamptz '2026-11-03 23:00:00+00', $1, $2
                from private.ballots where tracking_code = 'SEED-0001'`,
          params: [castHash, nextHash],
        },
        { sql: `set local role ${role}` },
        {
          sql: `select e.event_type, e.from_status, e.to_status, e.prev_hash, e.hash,
                       to_char(e.occurred_on, 'YYYY-MM-DD') as day
                from ballot_event_public e join ballot_public b on b.id = e.ballot_id
                where b.tracking_code = 'SEED-0001'`,
        },
      ]);
      const cast = rows.find((r) => r.event_type === "CAST");
      const change = rows.find((r) => r.event_type === "STATUS_CHANGE");
      expect(cast?.hash).toBe(castHash);
      expect(change?.prev_hash).toBe(cast?.hash);
      expect(change?.hash).toBe(
        sha256(`${change?.prev_hash}:STATUS_CHANGE:${change?.from_status}:${change?.to_status}:${change?.day}`),
      );
    });
  }
});

describeDb("resolution 8: publishing a stage record is its insert", () => {
  const db = useScratchDatabase({ seed: true });

  test("published_at is not null and defaults to now()", async () => {
    const { rows } = await db().query(
      `select is_nullable, column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'stage_records' and column_name = 'published_at'`,
    );
    expect(rows).toEqual([{ is_nullable: "NO", column_default: "now()" }]);
  });

  test("an unpublished (null published_at) stage record is rejected", async () => {
    await expect(
      asRole(
        db(),
        "service_role",
        `insert into stage_records (scope, scope_id, stage, merkle_root, ballot_count, published_at)
         values ('precinct', '18097-001', 'TALLIED_PRECINCT', 'draft', 17, null)`,
      ),
    ).rejects.toThrow(/null value in column "published_at"/);
  });

  for (const role of PUBLIC_ROLES) {
    test(`a stage record inserted without published_at is published at insert, and ${role} reads it`, async () => {
      const { rows } = await asRoleSteps(db(), "service_role", [
        {
          sql: `insert into stage_records (scope, scope_id, stage, merkle_root, ballot_count, totals, signature)
                values ('precinct', '18097-001', 'TALLIED_PRECINCT', 'root-now', 17, '{"mayor": {"a": 9, "b": 8}}', 'sig')`,
        },
        { sql: `set local role ${role}` },
        { sql: "select merkle_root, ballot_count from stage_records where merkle_root = 'root-now'" },
      ]);
      expect(rows).toEqual([{ merkle_root: "root-now", ballot_count: 17 }]);
    });
  }

  test("the insert sets published_at to the transaction time", async () => {
    const { rows } = await asRoleSteps(db(), "service_role", [
      {
        sql: `insert into stage_records (scope, scope_id, stage, merkle_root, ballot_count)
              values ('county', '18097', 'REPORTED_UNOFFICIAL', 'root-county', 34)`,
      },
      { sql: "select published_at = now() as at_insert from stage_records where merkle_root = 'root-county'" },
    ]);
    expect(rows).toEqual([{ at_insert: true }]);
  });
});

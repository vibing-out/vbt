// T-04 follow-up (#12): one block per review resolution this follow-up changes (1, 2, 3 and 8).
import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { asRole, asRoleSteps, describeDb, PERMISSION_DENIED, useScratchDatabase } from "./support.ts";

const PUBLIC_ROLES = ["anon", "authenticated"] as const;
const PUBLIC_VIEWS = ["ballot_event_public", "ballot_public"];
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const sorted = (values: string[]) => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
// The seed inserts SEED-0001 .. SEED-0050 in this order, so this is the cast (insertion) order.
const CAST_ORDER = Array.from({ length: 50 }, (_, i) => `SEED-${String(i + 1).padStart(4, "0")}`);

describeDb("resolution 1: nothing the public reads reveals cast order", () => {
  const db = useScratchDatabase({ seed: true });

  /** Every column in the public schema that anon may select, with its type and default. */
  async function publicColumns() {
    const { rows } = await db().query<{ col: string; data_type: string; column_default: string | null; is_identity: string }>(
      `select table_name || '.' || column_name as col, data_type, column_default, is_identity
       from information_schema.columns
       where table_schema = 'public'
         and has_column_privilege('anon', format('%I.%I', table_schema, table_name), column_name, 'SELECT')
       order by 1`,
    );
    expect(rows.length).toBeGreaterThan(0);
    return rows;
  }

  test("no public-readable column is a sequence or identity, and the schema has no sequences", async () => {
    const columns = await publicColumns();
    expect(columns.filter((c) => c.is_identity === "YES" || /nextval/.test(c.column_default ?? ""))).toEqual([]);
    const { rows } = await db().query("select sequence_name from information_schema.sequences where sequence_schema = 'public'");
    expect(rows).toEqual([]);
  });

  test("every uuid key defaults to gen_random_uuid() (random v4, not time-ordered)", async () => {
    const { rows } = await db().query<{ col: string; column_default: string | null }>(
      `select table_name || '.' || column_name as col, column_default from information_schema.columns
       where table_schema = 'public' and data_type = 'uuid' and column_default is not null order by 1`,
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
        { sql: "revoke select (occurred_on) on ballot_events from anon" },
        { sql: "set local role anon" },
        { sql: "select occurred_on from ballot_event_public" },
      ]),
    ).rejects.toThrow(PERMISSION_DENIED);
  });

  test("ballot_event_public applies the caller's RLS: without the public policy, anon sees no rows", async () => {
    const { rowCount } = await asRoleSteps(db(), "postgres", [
      { sql: "drop policy ballot_events_public_read on ballot_events" },
      { sql: "set local role anon" },
      { sql: "select id from ballot_event_public" },
    ]);
    expect(rowCount).toBe(0);
  });

  for (const role of PUBLIC_ROLES) {
    test(`${role} reads ballot_events' public columns, the date included, and no time`, async () => {
      const { rows } = await asRole(
        db(),
        role,
        "select count(*)::int as n from ballot_events where occurred_on = date '2026-11-03' and hash is not null",
      );
      expect(rows[0]).toEqual({ n: 50 });
      await expect(asRole(db(), role, "select occurred_at from ballot_events")).rejects.toThrow(PERMISSION_DENIED);
    });
  }

  test("the event date is derived from occurred_at and cannot be written directly", async () => {
    await expect(
      asRole(
        db(),
        "service_role",
        `insert into ballot_events (ballot_id, precinct_id, county_id, event_type, actor_role, actor_id,
                                    occurred_at, occurred_on, hash)
         select id, precinct_id, '18097', 'MISMATCH_DETECTED', 'county', 'c-1', now(), date '2000-01-01', 'h'
         from ballots where tracking_code = 'SEED-0001'`,
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
          sql: `insert into ballot_events (ballot_id, precinct_id, county_id, event_type, from_status, to_status,
                                           actor_role, actor_id, occurred_at, prev_hash, hash)
                select id, precinct_id, '18097', 'STATUS_CHANGE', 'CAST', 'TALLIED_PRECINCT', 'poll_worker', 'pw-1',
                       timestamptz '2026-11-03 23:00:00+00', $1, $2
                from ballots where tracking_code = 'SEED-0001'`,
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

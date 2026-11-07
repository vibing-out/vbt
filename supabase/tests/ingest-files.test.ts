import { expect, test } from "vitest";
import { asRole, asRoleSteps, describeDb, INSERT_ONLY, PERMISSION_DENIED, type Role, useScratchDatabase } from "./support.ts";

// T-05 AC3 and AC8: private.ingest_files is insert-only and server-only, the four RPCs are
// service_role only, and a ballot's event chain cannot fork.

const INSERT_FILE = `
  insert into private.ingest_files (sha256, kind, actor_id, ballot_count)
  values (repeat('a', 64), 'ballot_record', 'official-1', 3)
  returning id`;

const ROLES: Role[] = ["anon", "authenticated", "service_role", "postgres"];
const PUBLIC_ROLES = ["anon", "authenticated"] as const;

const RPCS = [
  "select public.ingest_ballot_record('{}'::jsonb)",
  "select public.chain_heads(array['SEED-0001'])",
  "select public.batch_members('precinct', '18097-001', 'CAST')",
  "select public.apply_batch('{}'::jsonb)",
];

describeDb("private.ingest_files is insert-only (AC3)", () => {
  const db = useScratchDatabase({ seed: true });

  test.each(ROLES)("update fails for %s", async (role) => {
    await expect(
      asRoleSteps(db(), "postgres", [{ sql: INSERT_FILE }, { sql: `set local role ${role}` }, { sql: "update private.ingest_files set ballot_count = 4" }]),
    ).rejects.toThrow(role === "postgres" ? INSERT_ONLY : PERMISSION_DENIED);
  });

  test.each(ROLES)("delete fails for %s", async (role) => {
    await expect(
      asRoleSteps(db(), "postgres", [{ sql: INSERT_FILE }, { sql: `set local role ${role}` }, { sql: "delete from private.ingest_files" }]),
    ).rejects.toThrow(role === "postgres" ? INSERT_ONLY : PERMISSION_DENIED);
  });

  test("the trigger blocks update and delete even with the grants restored", async () => {
    for (const statement of ["update private.ingest_files set ballot_count = 4", "delete from private.ingest_files"]) {
      await expect(
        asRoleSteps(db(), "postgres", [
          { sql: INSERT_FILE },
          { sql: "grant update, delete on private.ingest_files to service_role" },
          { sql: "set local role service_role" },
          { sql: statement },
        ]),
      ).rejects.toThrow(INSERT_ONLY);
    }
  });

  test("truncate fails, even for the owner", async () => {
    await expect(asRole(db(), "postgres", "truncate private.ingest_files")).rejects.toThrow(INSERT_ONLY);
  });

  test("a sha256 is recorded once", async () => {
    await expect(asRoleSteps(db(), "postgres", [{ sql: INSERT_FILE }, { sql: INSERT_FILE }])).rejects.toThrow(
      /ingest_files_sha256_key/,
    );
  });

  test("service_role reads it but cannot insert directly (only through ingest_ballot_record)", async () => {
    const { rows } = await asRole(db(), "service_role", "select count(*)::int as n from private.ingest_files");
    expect(rows).toEqual([{ n: 0 }]);
    await expect(asRole(db(), "service_role", INSERT_FILE)).rejects.toThrow(PERMISSION_DENIED);
  });

  test("holds exactly the approved columns", async () => {
    const { rows } = await db().query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'private' and table_name = 'ingest_files' order by 1`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(["actor_id", "ballot_count", "id", "kind", "recorded_at", "sha256"]);
  });
});

describeDb("the public cannot reach ingest records or the T-05 RPCs (AC8)", () => {
  const db = useScratchDatabase({ seed: true });

  for (const role of PUBLIC_ROLES) {
    test(`${role} cannot select private.ingest_files`, async () => {
      await expect(asRole(db(), role, "select * from private.ingest_files")).rejects.toThrow(PERMISSION_DENIED);
      await expect(asRole(db(), role, INSERT_FILE)).rejects.toThrow(PERMISSION_DENIED);
    });

    test.each(RPCS)(`${role} cannot execute %s`, async (sql) => {
      await expect(asRole(db(), role, sql)).rejects.toThrow(PERMISSION_DENIED);
    });
  }

  test("each RPC is security definer with an empty search_path, executable by service_role only", async () => {
    const { rows } = await db().query<{ name: string; definer: boolean; config: string[] | null; acl: string }>(
      `select p.proname as name, p.prosecdef as definer, p.proconfig as config, p.proacl::text as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('ingest_ballot_record', 'chain_heads', 'batch_members', 'apply_batch')
       order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual(["apply_batch", "batch_members", "chain_heads", "ingest_ballot_record"]);
    for (const row of rows) {
      expect(row.definer, row.name).toBe(true);
      expect(row.config, row.name).toEqual(['search_path=""']);
      const grantees = [...row.acl.matchAll(/([a-z_]*)=X/g)].map((m) => m[1]).filter((g) => g !== "postgres");
      expect(grantees, row.name).toEqual(["service_role"]);
    }
  });

  test("service_role can execute the read-only RPC", async () => {
    const { rows } = await asRole(db(), "service_role", "select public.chain_heads(array['SEED-0001']) as r");
    expect(rows[0].r).toEqual([expect.objectContaining({ tracking_code: "SEED-0001", current_status: "CAST", heads: 1 })]);
  });
});

describeDb("a ballot's chain cannot fork (C9)", () => {
  const db = useScratchDatabase({ seed: true });

  const EVENT = (prev: string | null, hash: string) => ({
    sql: `insert into private.ballot_events (ballot_id, precinct_id, county_id, event_type, from_status, to_status,
                                             actor_role, actor_id, occurred_at, prev_hash, hash)
          select id, precinct_id, '18097', 'STATUS_CHANGE', 'CAST', 'TALLIED_PRECINCT', 'county', 'o', now(), $1, $2
          from private.ballots where tracking_code = 'SEED-0001'`,
    params: [prev, hash],
  });

  test("two events with the same prev_hash are refused", async () => {
    const { rows } = await db().query("select e.hash from private.ballot_events e join private.ballots b on b.id = e.ballot_id where b.tracking_code = 'SEED-0001'");
    const head = rows[0].hash as string;
    await expect(asRoleSteps(db(), "service_role", [EVENT(head, "1".repeat(64)), EVENT(head, "2".repeat(64))])).rejects.toThrow(
      /ballot_events_ballot_id_prev_hash_key/,
    );
  });

  test("a second first event (prev_hash null) is refused", async () => {
    await expect(asRoleSteps(db(), "service_role", [EVENT(null, "3".repeat(64))])).rejects.toThrow(
      /ballot_events_ballot_id_prev_hash_key/,
    );
  });
});

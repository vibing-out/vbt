import { BALLOT_STATUSES, BATCH_SCOPES } from "@vbt/domain";
import { expect, test } from "vitest";
import { migrationFiles } from "../lib/db.ts";
import { asRole, asRoleSteps, describeDb, useScratchDatabase } from "./support.ts";

// ballots and ballot_events live in private, out of the Data API's reach (resolution 1).
const PUBLIC_TABLES = ["app_info", "batches", "machines", "official_roles", "precincts", "stage_records"];
const PRIVATE_TABLES = ["ballot_events", "ballots", "ingest_files"];
const TABLES = [...PUBLIC_TABLES.map((t) => `public.${t}`), ...PRIVATE_TABLES.map((t) => `private.${t}`)].sort();

describeDb("migrations on an empty database", () => {
  const db = useScratchDatabase();

  test("apply cleanly in order, app_info first, creating every table and public view", async () => {
    const files = migrationFiles();
    expect(files[0]).toBe("20261107163000_app_info.sql");
    expect(files.length).toBeGreaterThan(1);

    const { rows } = await db().query<{ name: string; kind: string }>(
      `select c.relname as name, c.relkind as kind from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'v') order by 1`,
    );
    expect(rows.filter((r) => r.kind !== "v").map((r) => r.name)).toEqual(PUBLIC_TABLES);
    expect(rows.filter((r) => r.kind === "v").map((r) => r.name)).toEqual(["ballot_event_public", "ballot_public"]);

    const priv = await db().query<{ name: string; kind: string }>(
      `select c.relname as name, c.relkind as kind from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'private' and c.relkind in ('r', 'p', 'v', 'm', 'f') order by 1`,
    );
    expect(priv.rows).toEqual(PRIVATE_TABLES.map((name) => ({ name, kind: "r" })));
  });

  test("keep the T-01 hello-world row readable by the public", async () => {
    const { rows } = await asRole(db(), "anon", "select value from app_info where key = 'greeting'");
    expect(rows).toEqual([{ value: "Hello, VBT" }]);
  });

  test("enable row level security on every table", async () => {
    const { rows } = await db().query<{ name: string; rls: boolean }>(
      `select n.nspname || '.' || c.relname as name, c.relrowsecurity as rls from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual(TABLES);
    expect(rows.filter((r) => !r.rls)).toEqual([]);
  });
});

describeDb("status and scope checks mirror @vbt/domain", () => {
  const db = useScratchDatabase({ seed: true });

  async function allowedValues(constraint: string): Promise<string[]> {
    const { rows } = await db().query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1",
      [constraint],
    );
    expect(rows).toHaveLength(1);
    return [...rows[0]!.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!).sort();
  }

  test.each([
    "ballots_current_status_check",
    "batches_from_status_check",
    "batches_to_status_check",
    "ballot_events_from_status_check",
    "ballot_events_to_status_check",
    "stage_records_stage_check",
  ])("%s allows exactly BALLOT_STATUSES", async (constraint) => {
    expect(await allowedValues(constraint)).toEqual([...BALLOT_STATUSES].sort());
  });

  test.each(["batches_scope_check", "stage_records_scope_check"])(
    "%s allows exactly BATCH_SCOPES",
    async (constraint) => {
      expect(await allowedValues(constraint)).toEqual([...BATCH_SCOPES].sort());
    },
  );

  test.each([...BALLOT_STATUSES])("a ballot can hold status %s", async (status) => {
    const { rowCount } = await asRole(
      db(),
      "service_role",
      "update private.ballots set current_status = $1 where tracking_code = 'SEED-0001'",
      [status],
    );
    expect(rowCount).toBe(1);
  });

  test("a status outside the domain is rejected", async () => {
    await expect(
      asRole(db(), "service_role", "update private.ballots set current_status = 'LOST' where tracking_code = 'SEED-0001'"),
    ).rejects.toThrow(/ballots_current_status_check/);
  });

  test("a scope outside the domain is rejected", async () => {
    await expect(
      asRoleSteps(db(), "service_role", [
        {
          sql: `insert into batches (scope, scope_id, from_status, to_status, actor_id, ballot_count)
                values ('state', 'IN', 'CAST', 'TALLIED_PRECINCT', 'official-1', 0)`,
        },
      ]),
    ).rejects.toThrow(/batches_scope_check/);
  });
});

describeDb("no column stores voter identity", () => {
  const db = useScratchDatabase();

  // Locked interfaces: "No table holds a voter's name, ID, date of birth, or signature."
  const IDENTITY = /(^|_)(name|first|last|surname|voter|dob|birth|ssn|signature|email|phone|address|street|zip|postal|registration|license|gender|sex)(_|$)/;
  // Allowed, with the reason they are not voter identity.
  const ALLOWED = new Set([
    "precincts.name", // the precinct's name
    "stage_records.signature", // the officials' cryptographic signature over a published record
  ]);

  test("no column in the public or private schema matches the identity deny-list", async () => {
    const { rows } = await db().query<{ col: string }>(
      `select table_name || '.' || column_name as col from information_schema.columns
       where table_schema in ('public', 'private') order by 1`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const flagged = rows.map((r) => r.col).filter((col) => IDENTITY.test(col.split(".")[1]!) && !ALLOWED.has(col));
    expect(flagged).toEqual([]);
  });

  test("ballots holds exactly the locked columns", async () => {
    const { rows } = await db().query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'private' and table_name = 'ballots' order by 1`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(
      [
        "ballot_style",
        "cast_date",
        "ciphertext",
        "ciphertext_hash",
        "current_status",
        "id",
        "machine_id",
        "mismatch",
        "precinct_id",
        "prev_tracking_code",
        "tracking_code",
      ],
    );
  });

  // T-20: officials' sign-in grants hold an auth user id, a role and a scope; never a name or email.
  // Voters have no accounts, so no row here is a voter.
  test("official_roles holds exactly user_id, role, scope, scope_id and created_at", async () => {
    const { rows } = await db().query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'official_roles' order by 1`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(["created_at", "role", "scope", "scope_id", "user_id"]);
  });

  test("the deny-list catches identity columns", () => {
    for (const col of ["voter_id", "first_name", "date_of_birth", "dob", "phone", "email", "voter_signature"]) {
      expect(IDENTITY.test(col)).toBe(true);
    }
    for (const col of ["tracking_code", "ciphertext_hash", "cast_date", "actor_id", "precinct_id"]) {
      expect(IDENTITY.test(col)).toBe(false);
    }
  });
});

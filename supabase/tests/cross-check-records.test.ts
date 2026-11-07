// T-10 (#20): machine_log_imports, official_results and check_results. Private and official-only: only
// service_role (server code behind requireRole's role and MFA check) reaches them; even an official's
// own aal2 session does not. Insert-only, no voter identity, and their value lists mirror @vbt/domain
// and @vbt/events. ballot_events is unchanged.
import { CHECK_FAILURES, CHECK_SCOPES, CROSS_CHECKS } from "@vbt/domain";
import { LOG_FORMATS, RESULTS_STAGE_RULES } from "@vbt/events";
import { expect, test } from "vitest";
import { asRole, asRoleSteps, describeDb, INSERT_ONLY, PERMISSION_DENIED, type Role, useScratchDatabase, withClaims } from "./support.ts";

const SHA = "a".repeat(64);
const OFFICIAL = "00000000-0000-4000-8000-000000000011";
const T10_TABLES_SQL = "('machine_log_imports', 'official_results', 'check_results')";

const INSERTS = {
  "private.machine_log_imports": `
    insert into private.machine_log_imports
      (machine_id, precinct_id, county_id, election_id, format, file_sha256, ballots_counted, polls_opened,
       polls_closed, error_count, unmapped_codes, uploaded_by)
    values ('M-18097-001-A', '18097-001', '18097', '2026-general', 'cdf-xml', '${SHA}', 12, true, true, 0,
       '{ballot-invalidated}', '${OFFICIAL}')`,
  "private.official_results": `
    insert into private.official_results
      (scope, scope_id, county_id, stage, nist_status, totals, ballot_count, file_sha256, uploaded_by)
    values ('precinct', '18097-001', '18097', 'TALLIED_PRECINCT', 'unofficial-complete',
       '{"mayor": {"ada": 7, "bo": 5}}', 12, '${SHA}', '${OFFICIAL}')`,
  "private.check_results": `
    insert into private.check_results (check_id, scope, scope_id, stage, passed, failure, mismatches)
    values ('C1', 'machine', 'M-18097-001-A', 'TALLIED_PRECINCT', false, 'COUNT_MISMATCH',
       '[{"field": "ballot_count", "expected": 13, "actual": 12}]')`,
} as const;
const TABLES = Object.keys(INSERTS) as Array<keyof typeof INSERTS>;

const asOfficial = [
  { sql: "insert into auth.users (id) values ($1)", params: [OFFICIAL] },
  { sql: "insert into public.official_roles (user_id, role, scope, scope_id) values ($1, 'state', null, null)", params: [OFFICIAL] },
];

describeDb("cross-check records: access", () => {
  const db = useScratchDatabase({ seed: true });

  test("all three exist in private with RLS enabled", async () => {
    const { rows } = await db().query<{ table: string; rls: boolean }>(
      `select c.relname as table, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'private' and c.relname in ${T10_TABLES_SQL} order by 1`,
    );
    expect(rows).toEqual([
      { table: "check_results", rls: true },
      { table: "machine_log_imports", rls: true },
      { table: "official_results", rls: true },
    ]);
  });

  test.each(TABLES)("service_role inserts into and reads %s", async (table) => {
    const { rows } = await asRoleSteps(db(), "service_role", [{ sql: INSERTS[table] }, { sql: `select count(*)::int as n from ${table}` }]);
    expect(rows).toEqual([{ n: 1 }]);
  });

  test.each(TABLES)("even a state official's aal2 session cannot read %s directly", async (table) => {
    await expect(
      asRoleSteps(db(), "postgres", [
        { sql: INSERTS[table] },
        ...asOfficial,
        withClaims({ sub: OFFICIAL, role: "authenticated", aal: "aal2" }),
        { sql: "set local role authenticated" },
        { sql: `select count(*) from ${table}` },
      ]),
    ).rejects.toThrow(PERMISSION_DENIED);
  });

  for (const role of ["anon", "authenticated"] as const) {
    test.each(TABLES)(`${role} gets permission denied on select and insert into %s`, async (table) => {
      await expect(asRole(db(), role, `select * from ${table}`)).rejects.toThrow(PERMISSION_DENIED);
      await expect(asRole(db(), role, INSERTS[table])).rejects.toThrow(PERMISSION_DENIED);
    });
  }

  test("RLS admits only service_role", async () => {
    const { rows } = await db().query<{ table: string; roles: string[] }>(
      `select tablename as table, roles::text[] as roles from pg_policies
       where schemaname = 'private' and tablename in ${T10_TABLES_SQL} order by 1`,
    );
    expect(rows).toEqual(["check_results", "machine_log_imports", "official_results"].map((table) => ({ table, roles: ["service_role"] })));
  });

  test("none of the three is in the schema the Data API exposes", async () => {
    const { rows } = await db().query(
      `select table_name from information_schema.tables where table_schema = 'public' and table_name in ${T10_TABLES_SQL}`,
    );
    expect(rows).toEqual([]);
  });

  test("a log for a machine that is not in machines is refused", async () => {
    await expect(asRole(db(), "service_role", INSERTS["private.machine_log_imports"].replace("'M-18097-001-A'", "'M-UNKNOWN'"))).rejects.toThrow(
      /machine_log_imports_machine_id_fkey/,
    );
  });
});

describeDb("cross-check records: insert-only", () => {
  const db = useScratchDatabase({ seed: true });
  const ROLES: Role[] = ["service_role", "postgres", "anon", "authenticated"];

  for (const table of TABLES) {
    test.each(ROLES)(`${table}: update and delete fail for %s`, async (role) => {
      for (const change of [`update ${table} set id = id`, `delete from ${table}`]) {
        await expect(
          asRoleSteps(db(), "postgres", [{ sql: INSERTS[table] }, { sql: `set local role ${role}` }, { sql: change }]),
        ).rejects.toThrow(role === "postgres" ? INSERT_ONLY : /insert-only|permission denied/);
      }
    });

    test.each(ROLES)(`${table}: truncate fails for %s`, async (role) => {
      await expect(asRole(db(), role, `truncate ${table}`)).rejects.toThrow(role === "postgres" ? INSERT_ONLY : /insert-only|permission denied/);
    });
  }

  test("the same machine log file is imported once", async () => {
    await expect(
      asRoleSteps(db(), "service_role", [{ sql: INSERTS["private.machine_log_imports"] }, { sql: INSERTS["private.machine_log_imports"] }]),
    ).rejects.toThrow(/machine_log_imports_once/);
  });
});

describeDb("cross-check records: value lists mirror the code", () => {
  const db = useScratchDatabase({ seed: true });

  async function allowedValues(constraint: string): Promise<string[]> {
    const { rows } = await db().query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1", [constraint]);
    expect(rows).toHaveLength(1);
    return [...new Set([...rows[0]!.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!))].sort();
  }

  test("check ids, scopes, stages and failures match @vbt/domain", async () => {
    expect(await allowedValues("check_results_check_id_check")).toEqual(CROSS_CHECKS.map((c) => c.id).sort());
    expect(await allowedValues("check_results_scope_check")).toEqual([...CHECK_SCOPES].sort());
    expect(await allowedValues("check_results_stage_check")).toEqual([...new Set(CROSS_CHECKS.map((c) => c.runsAt))].sort());
    expect(await allowedValues("check_results_failure_check")).toEqual([...CHECK_FAILURES].sort());
  });

  test("log formats, stages and statuses match @vbt/events", async () => {
    expect(await allowedValues("machine_log_imports_format_check")).toEqual([...LOG_FORMATS].sort());
    expect(await allowedValues("official_results_stage_check")).toEqual([...new Set(RESULTS_STAGE_RULES.map((r) => r.stage))].sort());
    expect(await allowedValues("official_results_nist_status_check")).toEqual([...new Set(RESULTS_STAGE_RULES.map((r) => r.status))].sort());
  });

  const results = (scope: string, stage: string, status: string) =>
    asRole(
      db(),
      "service_role",
      `insert into private.official_results (scope, scope_id, county_id, stage, nist_status, totals, file_sha256, uploaded_by)
       values ($1, '18097', '18097', $2, $3, '{}', '${SHA}', '${OFFICIAL}')`,
      [scope, stage, status],
    );

  test.each(RESULTS_STAGE_RULES)("official_results accepts the rule $level + $status = $stage", async ({ level, status, stage }) => {
    await expect(results(level, stage, status)).resolves.toMatchObject({ rowCount: 1 });
  });

  test.each([
    ["county", "TALLIED_PRECINCT", "unofficial-complete"],
    ["county", "CERTIFIED", "unofficial-complete"],
    ["county", "REPORTED_UNOFFICIAL", "certified"],
  ])("official_results refuses a %s row at %s with %s", async (scope, stage, status) => {
    await expect(results(scope, stage, status)).rejects.toThrow(/official_results_stage_rule/);
  });

  const definitions = CROSS_CHECKS.flatMap(({ id, runsAt, scopes }) => scopes.map((scope) => ({ id, runsAt, scope })));
  test.each(definitions)("$id is accepted at its locked stage for scope $scope, and nowhere else", async ({ id, scope, runsAt }) => {
    const insert = (s: string, stage: string) =>
      asRole(db(), "service_role", "insert into private.check_results (check_id, scope, scope_id, stage, passed) values ($1, $2, 'x', $3, true)", [
        id,
        s,
        stage,
      ]);
    await expect(insert(scope, runsAt)).resolves.toMatchObject({ rowCount: 1 });
    const otherScope = CHECK_SCOPES.find((s) => !CROSS_CHECKS.find((c) => c.id === id)!.scopes.includes(s))!;
    await expect(insert(otherScope, runsAt)).rejects.toThrow(/check_results_definition/);
    const otherStage = runsAt === "CERTIFIED" ? "TALLIED_PRECINCT" : "CERTIFIED";
    await expect(insert(scope, otherStage)).rejects.toThrow(/check_results_definition/);
  });

  test.each([
    ["a pass with a failure", "true, 'COUNT_MISMATCH', '[]'"],
    ["a pass with mismatches", `true, null, '[{"field": "ballot_count", "expected": 1, "actual": 2}]'`],
    ["a failure without a reason", "false, null, '[]'"],
  ])("check_results refuses %s", async (_, values) => {
    await expect(
      asRole(
        db(),
        "service_role",
        `insert into private.check_results (check_id, scope, scope_id, stage, passed, failure, mismatches)
         values ('C2', 'precinct', '18097-001', 'TALLIED_PRECINCT', ${values})`,
      ),
    ).rejects.toThrow(/check_results_outcome/);
  });

  test("a county row must be its own county, a file hash must be hex SHA-256, uploaded_by must be a uuid", async () => {
    const insert = (countyId: string, sha: string, by: string) =>
      asRole(
        db(),
        "service_role",
        `insert into private.official_results (scope, scope_id, county_id, stage, nist_status, totals, file_sha256, uploaded_by)
         values ('county', '18097', $1, 'CERTIFIED', 'certified', '{}', $2, $3)`,
        [countyId, sha, by],
      );
    await expect(insert("18057", SHA, OFFICIAL)).rejects.toThrow(/official_results_county_scope/);
    await expect(insert("18097", "not-a-hash", OFFICIAL)).rejects.toThrow(/file_sha256/);
    await expect(insert("18097", SHA, "Jane Official")).rejects.toThrow(/invalid input syntax for type uuid/);
  });
});

describeDb("cross-check records hold no voter identity, ballot or tracking code", () => {
  const db = useScratchDatabase();

  test("no column name matches a voter-identity, ballot, tracking or event-time pattern", async () => {
    const { rows } = await db().query<{ col: string }>(
      `select table_name || '.' || column_name as col from information_schema.columns
       where table_schema = 'private' and table_name in ${T10_TABLES_SQL}
         and column_name ~ '(name|dob|birth|voter|signature|phone|ballot_id|tracking|occurred|timestamp|sequence)'`,
    );
    expect(rows).toEqual([]);
  });

  test("ballot_events columns are unchanged by T-10", async () => {
    const { rows } = await db().query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema = 'private' and table_name = 'ballot_events' order by ordinal_position",
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      "id",
      "ballot_id",
      "precinct_id",
      "county_id",
      "event_type",
      "from_status",
      "to_status",
      "actor_role",
      "actor_id",
      "batch_id",
      "reason",
      "nist_event_code",
      "occurred_at",
      "recorded_at",
      "prev_hash",
      "hash",
      "occurred_on",
    ]);
  });
});

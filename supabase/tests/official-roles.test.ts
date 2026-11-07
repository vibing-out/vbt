// T-20 (#13): official_roles, its scope CHECKs and its RLS (own row only, aal2 only, service_role writes).
import { OFFICIAL_ROLES } from "@vbt/domain";
import { expect, test } from "vitest";
import { asRole, asRoleSteps, describeDb, PERMISSION_DENIED, useScratchDatabase, withClaims } from "./support.ts";

const POLL_WORKER = "00000000-0000-4000-8000-000000000001";
const COUNTY = "00000000-0000-4000-8000-000000000002";
const STATE = "00000000-0000-4000-8000-000000000003";
const NO_GRANT = "00000000-0000-4000-8000-000000000004";

/** Steps (as postgres) that create the auth users and their grants inside the test's transaction. */
const seedGrants = [
  {
    sql: "insert into auth.users (id) values ($1), ($2), ($3), ($4)",
    params: [POLL_WORKER, COUNTY, STATE, NO_GRANT],
  },
  {
    sql: `insert into public.official_roles (user_id, role, scope, scope_id) values
            ($1, 'poll_worker', 'precinct', '18097-001'),
            ($2, 'county', 'county', '18097'),
            ($3, 'state', null, null)`,
    params: [POLL_WORKER, COUNTY, STATE],
  },
];

const session = (sub: string, aal: string | undefined) => ({
  sub,
  role: "authenticated",
  ...(aal === undefined ? {} : { aal }),
});

describeDb("official_roles RLS", () => {
  const db = useScratchDatabase({ seed: true });

  /** Reads official_roles as `authenticated` with the given claims. */
  const readAs = (claims: Record<string, unknown>, sql = "select user_id, role, scope, scope_id from official_roles") =>
    asRoleSteps(db(), "postgres", [...seedGrants, withClaims(claims), { sql: "set local role authenticated" }, { sql }]);

  test.each([
    [POLL_WORKER, { role: "poll_worker", scope: "precinct", scope_id: "18097-001" }],
    [COUNTY, { role: "county", scope: "county", scope_id: "18097" }],
    [STATE, { role: "state", scope: null, scope_id: null }],
  ])("an aal2 session for %s reads exactly its own row", async (userId, grant) => {
    const { rows } = await readAs(session(userId, "aal2"));
    expect(rows).toEqual([{ user_id: userId, ...grant }]);
  });

  test("an aal2 session cannot read another official's row, even by asking for it", async () => {
    const { rows } = await readAs(
      session(POLL_WORKER, "aal2"),
      `select user_id from official_roles where user_id = '${STATE}'`,
    );
    expect(rows).toEqual([]);
  });

  test("an aal2 session without a grant reads nothing", async () => {
    const { rows } = await readAs(session(NO_GRANT, "aal2"));
    expect(rows).toEqual([]);
  });

  test.each([
    ["aal1", session(POLL_WORKER, "aal1")],
    ["no aal claim", session(POLL_WORKER, undefined)],
    ["no claims at all", {}],
    ["aal2 without a subject", { role: "authenticated", aal: "aal2" }],
  ])("a single-factor or incomplete session (%s) reads 0 rows", async (_name, claims) => {
    const { rows } = await readAs(claims);
    expect(rows).toEqual([]);
  });

  test("authenticated cannot read created_at", async () => {
    await expect(readAs(session(POLL_WORKER, "aal2"), "select created_at from official_roles")).rejects.toThrow(
      PERMISSION_DENIED,
    );
  });

  test("anon is denied", async () => {
    await expect(asRole(db(), "anon", "select role from official_roles")).rejects.toThrow(PERMISSION_DENIED);
  });

  test.each([
    `insert into official_roles (user_id, role, scope, scope_id) values ('${NO_GRANT}', 'state', null, null)`,
    `update official_roles set role = 'state', scope = null, scope_id = null where user_id = '${POLL_WORKER}'`,
    `update official_roles set scope_id = '18097-002' where user_id = '${POLL_WORKER}'`,
    `delete from official_roles where user_id = '${POLL_WORKER}'`,
  ])("an aal2 official cannot change grants: %s", async (sql) => {
    await expect(readAs(session(POLL_WORKER, "aal2"), sql)).rejects.toThrow(PERMISSION_DENIED);
  });

  test.each(["anon", "authenticated"] as const)("%s cannot insert a grant", async (role) => {
    await expect(
      asRole(db(), role, `insert into official_roles (user_id, role) values ('${NO_GRANT}', 'state')`),
    ).rejects.toThrow(PERMISSION_DENIED);
  });

  test("service_role inserts, updates and deletes grants", async () => {
    const { rows } = await asRoleSteps(db(), "postgres", [
      ...seedGrants,
      { sql: "set local role service_role" },
      { sql: `insert into official_roles (user_id, role, scope, scope_id) values ('${NO_GRANT}', 'county', 'county', '18057')` },
      { sql: `update official_roles set scope_id = '18097-002' where user_id = '${POLL_WORKER}'` },
      { sql: `delete from official_roles where user_id = '${STATE}'` },
      { sql: "select user_id, scope_id from official_roles order by user_id" },
    ]);
    expect(rows).toEqual([
      { user_id: POLL_WORKER, scope_id: "18097-002" },
      { user_id: COUNTY, scope_id: "18097" },
      { user_id: NO_GRANT, scope_id: "18057" },
    ]);
  });

  test("RLS is on, and the aal2 policy is restrictive", async () => {
    const { rows } = await db().query(
      `select policyname, permissive, roles::text[] as roles, cmd from pg_policies
       where schemaname = 'public' and tablename = 'official_roles' order by 1`,
    );
    expect(rows).toEqual([
      { policyname: "official_roles_read_own", permissive: "PERMISSIVE", roles: ["authenticated"], cmd: "SELECT" },
      { policyname: "official_roles_require_aal2", permissive: "RESTRICTIVE", roles: ["authenticated"], cmd: "ALL" },
      { policyname: "official_roles_service_write", permissive: "PERMISSIVE", roles: ["service_role"], cmd: "ALL" },
    ]);
    const rls = await db().query("select relrowsecurity from pg_class where oid = 'public.official_roles'::regclass");
    expect(rls.rows).toEqual([{ relrowsecurity: true }]);
  });
});

describeDb("official_roles constraints", () => {
  const db = useScratchDatabase();

  const insert = (values: string) =>
    asRoleSteps(db(), "postgres", [
      { sql: `insert into auth.users (id) values ('${POLL_WORKER}')` },
      { sql: "set local role service_role" },
      { sql: `insert into official_roles (user_id, role, scope, scope_id) values ('${POLL_WORKER}', ${values})` },
    ]);

  test.each([
    "'poll_worker', 'precinct', '18097-001'",
    "'county', 'county', '18097'",
    "'state', null, null",
  ])("accepts (%s)", async (values) => {
    await expect(insert(values)).resolves.toMatchObject({ rowCount: 1 });
  });

  test.each([
    "'poll_worker', null, null",
    "'poll_worker', 'precinct', null",
    "'poll_worker', 'precinct', ' '",
    "'poll_worker', 'county', '18097'",
    "'county', 'county', null",
    "'county', 'precinct', '18097-001'",
    "'state', null, '18097'",
    "'state', 'county', '18097'",
  ])("rejects a scope that does not fit the role (%s)", async (values) => {
    await expect(insert(values)).rejects.toThrow(/official_roles_scope_check/);
  });

  test.each(["'machine', null, null", "'simulator', null, null", "'voter', null, null"])(
    "rejects a role outside OFFICIAL_ROLES (%s)",
    async (values) => {
      await expect(insert(values)).rejects.toThrow(/official_roles_role_check/);
    },
  );

  test("the role CHECK allows exactly @vbt/domain OFFICIAL_ROLES", async () => {
    const { rows } = await db().query<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'official_roles_role_check'",
    );
    expect(rows).toHaveLength(1);
    const values = [...rows[0]!.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]!).sort();
    expect(values).toEqual([...OFFICIAL_ROLES].sort());
  });

  test("one grant per official", async () => {
    await expect(
      asRoleSteps(db(), "postgres", [
        { sql: `insert into auth.users (id) values ('${POLL_WORKER}')` },
        { sql: `insert into official_roles (user_id, role) values ('${POLL_WORKER}', 'state')` },
        { sql: `insert into official_roles (user_id, role, scope, scope_id) values ('${POLL_WORKER}', 'county', 'county', '18097')` },
      ]),
    ).rejects.toThrow(/official_roles_pkey/);
  });

  test("a grant needs an existing auth user, and goes when the user is deleted", async () => {
    await expect(
      asRoleSteps(db(), "postgres", [{ sql: `insert into official_roles (user_id, role) values ('${NO_GRANT}', 'state')` }]),
    ).rejects.toThrow(/foreign key/);
    const { rows } = await asRoleSteps(db(), "postgres", [
      { sql: `insert into auth.users (id) values ('${STATE}')` },
      { sql: `insert into official_roles (user_id, role) values ('${STATE}', 'state')` },
      { sql: `delete from auth.users where id = '${STATE}'` },
      { sql: "select count(*)::int as n from official_roles" },
    ]);
    expect(rows).toEqual([{ n: 0 }]);
  });
});

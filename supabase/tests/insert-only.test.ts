import { expect, test } from "vitest";
import { asRole, asRoleSteps, describeDb, INSERT_ONLY, PERMISSION_DENIED, type Role, useScratchDatabase } from "./support.ts";

const INSERT_EVENT = `
  insert into private.ballot_events (ballot_id, precinct_id, county_id, event_type, from_status, to_status,
                             actor_role, actor_id, occurred_at, prev_hash, hash)
  select id, precinct_id, '18097', 'STATUS_CHANGE', 'CAST', 'TALLIED_PRECINCT',
         'poll_worker', 'pw-1', now(), 'prev', 'next'
  from private.ballots where tracking_code = 'SEED-0001'
  returning id`;

const INSERT_STAGE_RECORD = `
  insert into stage_records (scope, scope_id, stage, merkle_root, ballot_count, totals, published_at, signature)
  values ('precinct', '18097-001', 'TALLIED_PRECINCT', 'root', 17, '{"mayor": {"a": 9, "b": 8}}', now(), 'sig')
  returning id`;

const INSERT_ONLY_TABLES = [
  { table: "private.ballot_events", insert: INSERT_EVENT },
  { table: "stage_records", insert: INSERT_STAGE_RECORD },
];

// Every role that can reach the database, from the public API key up to the table owner.
const ROLES: Role[] = ["anon", "authenticated", "service_role", "postgres"];

describeDb("insert-only tables", () => {
  const db = useScratchDatabase({ seed: true });

  test.each(INSERT_ONLY_TABLES)("service_role can insert into $table", async ({ insert }) => {
    const { rowCount } = await asRole(db(), "service_role", insert);
    expect(rowCount).toBe(1);
  });

  for (const { table, insert } of INSERT_ONLY_TABLES) {
    test.each(ROLES)(`${table}: update fails for %s`, async (role) => {
      await expect(
        asRoleSteps(db(), "postgres", [
          { sql: insert },
          { sql: `set local role ${role}` },
          { sql: `update ${table} set id = id` },
        ]),
      ).rejects.toThrow(role === "postgres" ? INSERT_ONLY : PERMISSION_DENIED);
    });

    test.each(ROLES)(`${table}: delete fails for %s`, async (role) => {
      await expect(
        asRoleSteps(db(), "postgres", [{ sql: insert }, { sql: `set local role ${role}` }, { sql: `delete from ${table}` }]),
      ).rejects.toThrow(role === "postgres" ? INSERT_ONLY : PERMISSION_DENIED);
    });

    test(`${table}: the trigger blocks update and delete even with the grants restored`, async () => {
      for (const statement of [`update ${table} set id = id`, `delete from ${table}`]) {
        await expect(
          asRoleSteps(db(), "postgres", [
            { sql: insert },
            { sql: `grant update, delete on ${table} to service_role` },
            { sql: "set local role service_role" },
            { sql: statement },
          ]),
        ).rejects.toThrow(INSERT_ONLY);
      }
    });

    test(`${table}: truncate fails, even for the owner`, async () => {
      await expect(asRole(db(), "postgres", `truncate ${table} cascade`)).rejects.toThrow(INSERT_ONLY);
    });
  }

  test("the seeded CAST events survive an attempted delete", async () => {
    await expect(asRole(db(), "postgres", "delete from private.ballot_events")).rejects.toThrow(INSERT_ONLY);
    const { rows } = await db().query("select count(*)::int as n from private.ballot_events");
    expect(rows[0]).toEqual({ n: 50 });
  });
});

describeDb("writes are server-only", () => {
  const db = useScratchDatabase({ seed: true });

  const PUBLIC_WRITES = [
    "insert into precincts (id, county_id, name) values ('x', 'y', 'z')",
    "insert into machines (id, precinct_id, vendor, model, public_key) values ('m', '18097-001', 'v', 'm', 'k')",
    `insert into private.ballots (tracking_code, ciphertext, ciphertext_hash, ballot_style, precinct_id, machine_id, cast_date)
     values ('NEW', 'c', 'h', 's', '18097-001', 'M-18097-001-A', current_date)`,
    `insert into batches (scope, scope_id, from_status, to_status, actor_id, ballot_count)
     values ('precinct', '18097-001', 'CAST', 'TALLIED_PRECINCT', 'pw-1', 0)`,
    INSERT_EVENT,
    INSERT_STAGE_RECORD,
    "insert into app_info (key, value) values ('k', 'v')",
    "update private.ballots set current_status = 'CERTIFIED'",
    "update private.ballots set mismatch = true",
    "update precincts set name = 'renamed'",
    "update app_info set value = 'changed'",
    "delete from private.ballots",
    "delete from machines",
    "delete from precincts",
    "delete from app_info",
  ];

  for (const role of ["anon", "authenticated"] as const) {
    test.each(PUBLIC_WRITES)(`${role} cannot: %s`, async (sql) => {
      await expect(asRole(db(), role, sql)).rejects.toThrow(PERMISSION_DENIED);
    });
  }

  test.each([
    "update private.ballots set ciphertext = 'tampered'",
    "update private.ballots set ciphertext_hash = 'tampered'",
    "update private.ballots set tracking_code = 'TAMPERED'",
    "update private.ballots set prev_tracking_code = 'TAMPERED'",
    "update private.ballots set cast_date = current_date - 1",
    "update private.ballots set current_status = 'CERTIFIED', ciphertext = 'tampered'",
  ])("service_role cannot change a ballot's fixed columns: %s", async (sql) => {
    await expect(asRole(db(), "service_role", sql)).rejects.toThrow(PERMISSION_DENIED);
  });

  test("service_role can update a ballot's current_status and mismatch", async () => {
    const { rows } = await asRoleSteps(db(), "service_role", [
      { sql: "update private.ballots set current_status = 'TALLIED_PRECINCT' where tracking_code = 'SEED-0001'" },
      { sql: "update private.ballots set mismatch = true where tracking_code = 'SEED-0001'" },
      {
        sql: "select current_status, mismatch, ciphertext_hash is not null as hashed from private.ballots where tracking_code = 'SEED-0001'",
      },
    ]);
    expect(rows).toEqual([{ current_status: "TALLIED_PRECINCT", mismatch: true, hashed: true }]);
  });

  test("service_role inserts, updates and deletes on the mutable tables", async () => {
    const result = await asRoleSteps(db(), "service_role", [
      { sql: "insert into precincts (id, county_id, name) values ('18097-003', '18097', 'Center 3')" },
      {
        sql: "insert into machines (id, precinct_id, vendor, model, public_key) values ('M-3', '18097-003', 'v', 'm', 'k')",
      },
      {
        sql: `insert into private.ballots (tracking_code, ciphertext, ciphertext_hash, ballot_style, precinct_id, machine_id, cast_date)
              values ('NEW-1', 'c', 'h', 's', '18097-003', 'M-3', current_date)`,
      },
      {
        sql: `insert into batches (scope, scope_id, from_status, to_status, actor_id, ballot_count)
              values ('precinct', '18097-003', 'CAST', 'TALLIED_PRECINCT', 'pw-1', 1)`,
      },
      { sql: "update private.ballots set current_status = 'TALLIED_PRECINCT', mismatch = true where tracking_code = 'NEW-1'" },
      { sql: "delete from private.ballots where tracking_code = 'NEW-1'" },
      { sql: "select count(*)::int as n from batches" },
    ]);
    expect(result.rows[0]).toEqual({ n: 1 });
  });
});

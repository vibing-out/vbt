// T-09 (#19): private.uploads, the record of uploaded file hashes (AC6, AC7).
import { expect, test } from "vitest";
import { asRole, asRoleSteps, describeDb, INSERT_ONLY, PERMISSION_DENIED, useScratchDatabase } from "./support.ts";

const HASH = "a".repeat(64);
const ACTOR = "00000000-0000-4000-8000-000000000001";
const INSERT = `insert into private.uploads (file_sha256, kind, scope_id, uploaded_by)
                values ('${HASH}', 'machine_log', '18097-001', '${ACTOR}')`;

describeDb("private.uploads", () => {
  const db = useScratchDatabase({ seed: true });

  test("has row level security enabled and exactly the approved columns", async () => {
    const { rows } = await db().query(
      `select c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'private' and c.relname = 'uploads'`,
    );
    expect(rows).toEqual([{ rls: true }]);
    const columns = await db().query(
      `select column_name from information_schema.columns
       where table_schema = 'private' and table_name = 'uploads' order by ordinal_position`,
    );
    expect(columns.rows.map((r) => r.column_name)).toEqual([
      "id",
      "file_sha256",
      "kind",
      "scope_id",
      "uploaded_by",
      "uploaded_at",
    ]);
  });

  for (const role of ["anon", "authenticated"] as const) {
    test(`${role} can neither read nor write it`, async () => {
      await expect(asRole(db(), role, "select id from private.uploads")).rejects.toThrow(PERMISSION_DENIED);
      await expect(asRole(db(), role, "select uploaded_at from private.uploads")).rejects.toThrow(PERMISSION_DENIED);
      await expect(asRole(db(), role, INSERT)).rejects.toThrow(PERMISSION_DENIED);
    });
  }

  test("service_role may insert and read, but never update or delete", async () => {
    const { rows } = await asRoleSteps(db(), "service_role", [{ sql: INSERT }, { sql: "select kind from private.uploads" }]);
    expect(rows).toEqual([{ kind: "machine_log" }]);
    for (const sql of ["update private.uploads set kind = 'county_totals'", "delete from private.uploads"]) {
      await expect(asRoleSteps(db(), "service_role", [{ sql: INSERT }, { sql }])).rejects.toThrow(PERMISSION_DENIED);
    }
  });

  test("the hash, kind and scope are checked", async () => {
    for (const [hash, kind, scope] of [
      ["A".repeat(64), "machine_log", "18097-001"],
      ["a".repeat(63), "machine_log", "18097-001"],
      [HASH, "cvr", "18097-001"],
      [HASH, "machine_log", "  "],
    ]) {
      await expect(
        asRole(
          db(),
          "service_role",
          "insert into private.uploads (file_sha256, kind, scope_id, uploaded_by) values ($1, $2, $3, $4)",
          [hash, kind, scope, ACTOR],
        ),
      ).rejects.toThrow(/violates check constraint/);
    }
  });

  test("the same file for the same kind and scope is one row; official_record_uploads is idempotent", async () => {
    const upload = JSON.stringify([{ file_sha256: HASH, kind: "machine_log", scope_id: "18097-001" }]);
    const { rows } = await asRoleSteps(db(), "service_role", [
      { sql: "select official_record_uploads($1::jsonb, $2) as r", params: [upload, ACTOR] },
      { sql: "select official_record_uploads($1::jsonb, $2) as again, (select count(*)::int from private.uploads) as n", params: [upload, ACTOR] },
    ]);
    expect(rows[0].n).toBe(1);
    expect(rows[0].again).toHaveLength(1);
    expect(Object.keys(rows[0].again[0]).sort()).toEqual(["file_sha256", "id", "kind", "scope_id"]);
    await expect(asRoleSteps(db(), "service_role", [{ sql: INSERT }, { sql: INSERT }])).rejects.toThrow(/duplicate key/);
  });

  test("the insert-only tables are untouched by this migration", async () => {
    await expect(asRole(db(), "postgres", "delete from private.ballot_events")).rejects.toThrow(INSERT_ONLY);
  });
});

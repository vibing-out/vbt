import { expect, test } from "vitest";
import { dbFailure, DbError, serviceDb } from "./service-db";
import { fakeSupabase, SECRET_KEY, SUPABASE_URL } from "./testing/fake-supabase";

const env = { NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, SUPABASE_SECRET_KEY: SECRET_KEY };

test("no URL or no secret key: no client", () => {
  expect(serviceDb({ ...env, SUPABASE_SECRET_KEY: "" })).toBeNull();
  expect(serviceDb({ ...env, NEXT_PUBLIC_SUPABASE_URL: undefined })).toBeNull();
});

test("RPCs go out with the secret key and named arguments; errors carry their SQLSTATE", async () => {
  const fake = fakeSupabase({
    rpc: (name) =>
      name === "chain_heads"
        ? Response.json([{ tracking_code: "A" }])
        : Response.json({ code: "VB409", message: "changed", details: null, hint: null }, { status: 400 }),
  });
  const db = serviceDb(env, fake.fetch)!;
  expect(await db.chainHeads(["A"])).toEqual([{ tracking_code: "A" }]);
  expect(fake.rpcCalls[0]).toEqual({ name: "chain_heads", args: { p_codes: ["A"] } });
  const error = await db.applyBatch({}).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(DbError);
  expect((error as DbError).code).toBe("VB409");
});

test("precinct and machine reads use the public tables", async () => {
  const fake = fakeSupabase();
  const db = serviceDb(env, fake.fetch)!;
  expect(await db.precincts(["18097-001", "18097-001", "nope"])).toEqual([{ id: "18097-001", county_id: "18097" }]);
  expect(await db.machines(["M-18057-001-A"])).toEqual([{ id: "M-18057-001-A", precinct_id: "18057-001" }]);
});

test.each([
  [new DbError("VB409", "changed"), 409, { error: "conflict", message: "changed" }],
  [new DbError("23505", "Key (tracking_code)=(X) already exists"), 409, { error: "conflict" }],
  [new DbError("40001", "serialization"), 409, { error: "conflict" }],
  [new DbError("VB422", "bad payload"), 422, { error: "bad payload", code: "REJECTED" }],
  [new DbError("XX000", "internals"), 500, { error: "internal_error" }],
  [new Error("network"), 500, { error: "internal_error" }],
])("dbFailure(%s) is %i without leaking database details", async (error, status, body) => {
  const response = dbFailure(error);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual(body);
});

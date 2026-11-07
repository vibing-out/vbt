import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { aal2, accessToken, ENV, fakeSupabase, LIVE_SESSION, USERS } from "../../../../lib/testing/fake-supabase";
import { GET } from "./route";

// The route with its real dependencies: process.env, the global fetch and next/headers cookies (which
// throw outside a request, so a cookie-less call can only be refused).
const call = (query = "", headers: Record<string, string> = {}) =>
  GET(new Request(`https://vbt.example/api/official/whoami${query}`, { headers }));
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.NEXT_PUBLIC_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  vi.stubGlobal("fetch", fakeSupabase().fetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("AC1: without signing in, with a garbage token or with a single-factor session: 403", async () => {
  for (const response of [
    await call(),
    await call("?precinct=18097-001"),
    await call("", bearer("x")),
    await call("", bearer(await accessToken({ sub: USERS.state, aal: "aal1" }))),
  ]) {
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  }
});

test("AC1: with no Supabase env the route still refuses (fails closed)", async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  expect((await call("", bearer(await aal2(USERS.state)))).status).toBe(403);
});

test.each([
  [USERS.pollWorker, { role: "poll_worker", scope: "precinct", scope_id: "18097-001" }],
  [USERS.county, { role: "county", scope: "county", scope_id: "18097" }],
  [USERS.state, { role: "state", scope: null, scope_id: null }],
])("an aal2 official (%s) gets 200 with only their own grant", async (user, grant) => {
  const response = await call("", bearer(await aal2(user)));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(grant);
});

test("AC2: the poll worker passes for their precinct and is refused elsewhere", async () => {
  const token = await aal2(USERS.pollWorker);
  expect((await call("?precinct=18097-001", bearer(token))).status).toBe(200);
  for (const query of ["?precinct=18097-002", "?precinct=18057-001", "?county=18097", "?precinct=99999-001"]) {
    expect((await call(query, bearer(token))).status, query).toBe(403);
  }
});

test("AC2: the county official passes for precincts in its county only", async () => {
  const token = await aal2(USERS.county);
  expect((await call("?precinct=18097-002", bearer(token))).status).toBe(200);
  expect((await call("?county=18097", bearer(token))).status).toBe(200);
  expect((await call("?precinct=18057-001", bearer(token))).status).toBe(403);
});

test("a malformed target is refused, even for the state official", async () => {
  const token = await aal2(USERS.state);
  for (const query of ["?precinct=", "?precinct=18097-001&county=18097", "?county=1&county=2"]) {
    expect((await call(query, bearer(token))).status, query).toBe(403);
  }
});

test("AC1: a signed-out or revoked aal2 session gets 403 before its token expires", async () => {
  const token = await aal2(USERS.state);
  expect((await call("", bearer(token))).status).toBe(200);
  vi.stubGlobal("fetch", fakeSupabase({ revokedSessions: [LIVE_SESSION] }).fetch);
  const response = await call("", bearer(token));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "forbidden" });
});

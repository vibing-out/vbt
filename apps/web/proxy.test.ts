import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { aal2, accessToken, ENV, fakeSupabase, LIVE_SESSION, sessionCookie, USERS } from "./lib/testing/fake-supabase";
import { config, pathTarget, proxy } from "./proxy";

// T-09 AC2: every /official page answers 403 to anyone but an aal2 official in scope, before rendering.
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.NEXT_PUBLIC_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  vi.stubGlobal("fetch", fakeSupabase().fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function visit(path: string, token?: string) {
  const headers = new Headers();
  if (token) {
    const cookie = sessionCookie(token);
    headers.set("cookie", `${cookie.name}=${cookie.value}`);
  }
  return proxy(new NextRequest(`https://vbt.example${path}`, { headers }));
}

const PAGES = ["/official", "/official/upload", "/official/precinct/18097-001", "/official/county/18097", "/official/challenges", "/official/mismatches?county=18097"];

test("the matcher covers /official and everything under it, and not /login", () => {
  expect(config.matcher).toEqual(["/official", "/official/:path*"]);
});

test.each(PAGES)("signed out, %s is 403", async (path) => {
  const response = await visit(path);
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "forbidden" });
});

test("a single-factor session, an official without a grant, and a revoked session get 403", async () => {
  expect((await visit("/official/precinct/18097-001", await accessToken({ sub: USERS.pollWorker, aal: "aal1" }))).status).toBe(403);
  expect((await visit("/official", await aal2(USERS.noGrant))).status).toBe(403);
  vi.stubGlobal("fetch", fakeSupabase({ revokedSessions: [LIVE_SESSION] }).fetch);
  expect((await visit("/official", await aal2(USERS.pollWorker))).status).toBe(403);
});

test("an aal2 official in scope passes; out of scope is 403", async () => {
  const pw = await aal2(USERS.pollWorker);
  expect((await visit("/official/precinct/18097-001", pw)).headers.get("x-middleware-next")).toBe("1");
  expect((await visit("/official/precinct/18097-002", pw)).status).toBe(403);
  expect((await visit("/official/county/18097", pw)).status).toBe(403);
  expect((await visit("/official/mismatches?county=18097", pw)).status).toBe(403);
  expect((await visit("/official/mismatches?county=18097&precinct=18097-001", pw)).status).toBe(403);
  const county = await aal2(USERS.county);
  expect((await visit("/official/county/18097", county)).headers.get("x-middleware-next")).toBe("1");
  expect((await visit("/official/challenges?county=18057", county)).status).toBe(403);
  expect((await visit("/official/county/18057", county)).status).toBe(403);
});

test("pathTarget reads precinct and county paths only", () => {
  expect(pathTarget("/official/precinct/18097-001")).toEqual({ scope: "precinct", id: "18097-001" });
  expect(pathTarget("/official/county/18097/")).toEqual({ scope: "county", id: "18097" });
  expect(pathTarget("/official/county/%E0%A4%A")).toEqual({ scope: "county", id: "" });
  expect(pathTarget("/official/upload")).toBeUndefined();
  expect(pathTarget("/official/precinct/a/b")).toBeUndefined();
});

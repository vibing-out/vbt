import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";
import { pageTarget } from "../app/official/scope";
import { requireOfficialPage } from "./page-guard";
import { aal2, accessToken, ENV, fakeSupabase, sessionCookie, USERS } from "./testing/fake-supabase";

// T-09 AC8: every official page re-checks role, scope and MFA on the server before it reads anything.
const OFFICIAL = join(import.meta.dirname, "..", "app", "official");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

const PAGES = pages(OFFICIAL).map((file) => relative(OFFICIAL, file));

test("the official pages are the T-09 set plus demo control (T-22)", () => {
  expect(PAGES.sort()).toEqual(
    ["challenges/page.tsx", "county/[id]/page.tsx", "demo/page.tsx", "mismatches/page.tsx", "page.tsx", "precinct/[id]/page.tsx", "upload/page.tsx"].map((p) => join(...p.split("/"))),
  );
});

test.each(PAGES)("%s calls requireOfficialPage once, returns on refusal, and reads data only after it", (page) => {
  const source = readFileSync(join(OFFICIAL, page), "utf8");
  const calls = [...source.matchAll(/const\s+(\w+)\s*=\s*await\s+requireOfficialPage\(/g)];
  expect(calls).toHaveLength(1);
  expect(source.match(/requireOfficialPage\(/g)).toHaveLength(1);
  const name = calls[0]![1]!;
  const after = source.slice(calls[0]!.index);
  const next = after.slice(after.indexOf(";") + 1).trimStart();
  expect(next).toMatch(new RegExp(`^if\\s*\\(\\s*!${name}\\s*\\)\\s*return\\s+<Forbidden\\s*/>;`));
  const guard = calls[0]!.index!;
  for (const read of ["serviceDb(", "mismatchReport("]) {
    const at = source.indexOf(read);
    if (at !== -1) expect(at, `${read} in ${page}`).toBeGreaterThan(guard);
  }
  expect(source).toMatch(/export default async function/);
  expect(source).toMatch(/^export const dynamic = "force-dynamic";$/m);
});

const deps = (cookie?: { name: string; value: string }) => ({
  env: ENV,
  fetch: fakeSupabase().fetch,
  cookies: async () => ({ getAll: () => (cookie ? [cookie] : []) }),
});

test("requireOfficialPage: null without a session, with aal1, without a grant or out of scope", async () => {
  expect(await requireOfficialPage(["poll_worker"], undefined, deps())).toBeNull();
  expect(await requireOfficialPage(["poll_worker"], undefined, deps(sessionCookie(await accessToken({ sub: USERS.pollWorker, aal: "aal1" }))))).toBeNull();
  expect(await requireOfficialPage(["poll_worker", "county", "state"], undefined, deps(sessionCookie(await aal2(USERS.noGrant))))).toBeNull();
  const pw = deps(sessionCookie(await aal2(USERS.pollWorker)));
  expect(await requireOfficialPage(["county", "state"], undefined, pw)).toBeNull();
  expect(await requireOfficialPage(["poll_worker"], { scope: "precinct", id: "18097-002" }, pw)).toBeNull();
});

test("requireOfficialPage: the official when the cookie session passes", async () => {
  const official = await requireOfficialPage(["poll_worker"], { scope: "precinct", id: "18097-001" }, deps(sessionCookie(await aal2(USERS.pollWorker))));
  expect(official).toEqual({ role: "poll_worker", scope: "precinct", scopeId: "18097-001", userId: USERS.pollWorker });
});

test("pageTarget: the query, else the official's own scope", () => {
  expect(pageTarget({ precinct: "18097-001" }, null)).toEqual({ scope: "precinct", id: "18097-001" });
  expect(pageTarget({ county: " 18097 " }, null)).toEqual({ scope: "county", id: "18097" });
  expect(pageTarget({ county: "18097", precinct: "18097-001" }, null)).toBeNull();
  expect(pageTarget({ county: ["a", "b"] }, null)).toBeNull();
  expect(pageTarget({}, { scope: "county", scopeId: "18097" })).toEqual({ scope: "county", id: "18097" });
  expect(pageTarget({}, { scope: null, scopeId: null })).toBeNull();
});

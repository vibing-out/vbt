import { OFFICIAL_ROLES, type OfficialRole, type OfficialTarget } from "@vbt/domain";
import { describe, expect, test, vi } from "vitest";
import { forbidden, parseTarget, requireRole, type RequireRoleDeps } from "./require-role";
import {
  aal2,
  accessToken,
  AUTH_COOKIE,
  ENV,
  fakeSupabase,
  type FakeSupabaseOptions,
  LIVE_SESSION,
  PUBLISHABLE_KEY,
  sessionCookie,
  USERS,
} from "./testing/fake-supabase";

const URL_BASE = "https://vbt.example/api/official/whoami";

const bearer = (token: string) => new Request(URL_BASE, { headers: { Authorization: `Bearer ${token}` } });
const noCookies = async () => ({ getAll: () => [] });

function deps(options: FakeSupabaseOptions = {}, extra: Partial<RequireRoleDeps> = {}) {
  const supabase = fakeSupabase(options);
  return { supabase, deps: { env: ENV, fetch: supabase.fetch, cookies: noCookies, ...extra } satisfies RequireRoleDeps };
}

async function check(
  request: Request,
  { roles = OFFICIAL_ROLES, target, options, extra }: {
    roles?: readonly OfficialRole[];
    target?: OfficialTarget;
    options?: FakeSupabaseOptions;
    extra?: Partial<RequireRoleDeps>;
  } = {},
) {
  const { deps: d, supabase } = deps(options, extra);
  return { result: await requireRole(request, roles, target, d), requests: supabase.requests };
}

async function expectForbidden(promise: Promise<{ result: Awaited<ReturnType<typeof requireRole>> }>) {
  const { result } = await promise;
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.response.status).toBe(403);
  expect(result.response.headers.get("cache-control")).toBe("no-store");
  expect(await result.response.json()).toEqual({ error: "forbidden" });
}

describe("AC1: an unauthenticated or single-factor session gets 403", () => {
  test("no Authorization header and no session cookie", async () => {
    await expectForbidden(check(new Request(URL_BASE)));
  });

  test("no Authorization header, outside a request (next/headers cookies() throws)", async () => {
    await expectForbidden(check(new Request(URL_BASE), { extra: { cookies: () => Promise.reject(new Error("no request scope")) } }));
  });

  test.each(["Bearer", "Bearer ", "Basic dXNlcjpwYXNz", "Bearer a b", "token"])(
    "a malformed Authorization header (%j), without falling back to cookies",
    async (header) => {
      const cookie = sessionCookie(await aal2(USERS.state));
      const cookies = vi.fn(async () => ({ getAll: () => [cookie] }));
      await expectForbidden(check(new Request(URL_BASE, { headers: { Authorization: header } }), { extra: { cookies } }));
      expect(cookies).not.toHaveBeenCalled();
    },
  );

  test.each(["x", "not.a.jwt", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4IiwiYWFsIjoiYWFsMiJ9."])("a garbage token (%s)", async (token) => {
    await expectForbidden(check(bearer(token)));
  });

  test("a token signed by a key the project does not trust (forged aal2)", async () => {
    await expectForbidden(check(bearer(await accessToken({ sub: USERS.state, aal: "aal2" }, { forged: true }))));
  });

  test("a token with an unknown key id, which the Auth server then rejects", async () => {
    const { result, requests } = await check(bearer(await accessToken({ sub: USERS.state, aal: "aal2" }, { kid: "other" })));
    expect(result.ok).toBe(false);
    expect(requests.some((r) => r.url.pathname === "/auth/v1/user")).toBe(true);
  });

  test("an expired aal2 token", async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    await expectForbidden(check(bearer(await accessToken({ sub: USERS.state, aal: "aal2", iat: past - 3600, exp: past }))));
  });

  test("a valid single-factor (aal1) session, for every role", async () => {
    for (const sub of [USERS.pollWorker, USERS.county, USERS.state]) {
      await expectForbidden(check(bearer(await accessToken({ sub, aal: "aal1" }))));
    }
  });

  test("a single-factor session is refused by requireRole itself, even if RLS returned the grant", async () => {
    const { result, requests } = await check(bearer(await accessToken({ sub: USERS.state, aal: "aal1" })), {
      options: { noRls: true },
    });
    expect(result.ok).toBe(false);
    expect(requests.some((r) => r.url.pathname.startsWith("/rest/v1/"))).toBe(false);
  });

  test("a valid session without an aal claim", async () => {
    await expectForbidden(check(bearer(await accessToken({ sub: USERS.state }))));
  });

  test("a valid aal2 token that is not a signed-in user (anon role, anonymous user, no subject)", async () => {
    await expectForbidden(check(bearer(await aal2(USERS.state, { role: "anon" }))));
    await expectForbidden(check(bearer(await aal2(USERS.state, { is_anonymous: true }))));
    await expectForbidden(check(bearer(await accessToken({ aal: "aal2" }))));
  });

  test("a single-factor cookie session", async () => {
    const cookie = sessionCookie(await accessToken({ sub: USERS.state, aal: "aal1" }));
    await expectForbidden(check(new Request(URL_BASE), { extra: { cookies: async () => ({ getAll: () => [cookie] }) } }));
  });

  test("a signed-out or revoked aal2 session, while its token is still unexpired (bearer and cookie)", async () => {
    const options = { revokedSessions: [LIVE_SESSION] };
    for (const user of [USERS.pollWorker, USERS.county, USERS.state]) {
      const token = await aal2(user);
      const { result, requests } = await check(bearer(token), { options });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(403);
      // Refused by the live-session check, before any grant lookup.
      expect(requests.some((r) => r.url.pathname === "/auth/v1/user")).toBe(true);
      expect(requests.some((r) => r.url.pathname.startsWith("/rest/v1/"))).toBe(false);
      const cookie = sessionCookie(token);
      await expectForbidden(check(new Request(URL_BASE), { options, extra: { cookies: async () => ({ getAll: () => [cookie] }) } }));
    }
    // Another session of the same official is unaffected.
    const { result } = await check(bearer(await aal2(USERS.state, { session_id: "other-live-session" })), { options });
    expect(result.ok).toBe(true);
  });

  test("an aal2 token without a session_id claim", async () => {
    await expectForbidden(check(bearer(await aal2(USERS.state, { session_id: undefined }))));
  });

  test.each([
    ["an error status", { userStatus: 500 }],
    ["a network failure", { networkFailure: /\/auth\/v1\/user/ }],
  ] as Array<[string, FakeSupabaseOptions]>)("the live-session check gives %s: 403", async (_name, options) => {
    await expectForbidden(check(bearer(await aal2(USERS.state)), { options }));
  });

  test.each([
    ["the Supabase URL", { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY }],
    ["the publishable key", { NEXT_PUBLIC_SUPABASE_URL: ENV.NEXT_PUBLIC_SUPABASE_URL }],
    ["both", {}],
  ])("missing %s in the env, without any network call", async (_name, env) => {
    const { result, requests } = await check(bearer(await aal2(USERS.state)), { extra: { env } });
    expect(result.ok).toBe(false);
    expect(requests).toEqual([]);
  });

  test("a malformed Supabase URL", async () => {
    await expectForbidden(check(bearer(await aal2(USERS.state)), { extra: { env: { ...ENV, NEXT_PUBLIC_SUPABASE_URL: "not a url" } } }));
  });

  test.each([
    ["an error status", { rolesStatus: 500 }],
    ["a network failure", { networkFailure: /official_roles/ }],
    ["no grant row", { rolesRows: () => [] }],
    ["two grant rows", { rolesRows: () => [{ role: "state", scope: null, scope_id: null }, { role: "state", scope: null, scope_id: null }] }],
    ["a malformed grant row", { rolesRows: () => [{ role: "state", scope: "county", scope_id: "18097" }] }],
    ["a role outside OFFICIAL_ROLES", { rolesRows: () => [{ role: "machine", scope: null, scope_id: null }] }],
  ] as Array<[string, FakeSupabaseOptions]>)("an aal2 session whose role lookup gives %s", async (_name, options) => {
    await expectForbidden(check(bearer(await aal2(USERS.state)), { options }));
  });

  test("an aal2 user with no official_roles grant", async () => {
    await expectForbidden(check(bearer(await aal2(USERS.noGrant))));
  });

  test("no allowed roles at all", async () => {
    await expectForbidden(check(bearer(await aal2(USERS.state)), { roles: [] }));
  });

  test("every refusal is the same 403", async () => {
    const response = forbidden();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });
});

describe("an aal2 official passes", () => {
  test("with a bearer token: the grant is read with the publishable key and the user's own token", async () => {
    const token = await aal2(USERS.pollWorker);
    const { result, requests } = await check(bearer(token));
    expect(result).toEqual({
      ok: true,
      official: { userId: USERS.pollWorker, role: "poll_worker", scope: "precinct", scopeId: "18097-001" },
    });
    const roles = requests.find((r) => r.url.pathname === "/rest/v1/official_roles");
    expect(roles?.method).toBe("GET");
    expect(roles?.headers.get("apikey")).toBe(PUBLISHABLE_KEY);
    expect(roles?.headers.get("authorization")).toBe(`Bearer ${token}`);
    // The session was confirmed live with the Auth server, with the user's own token.
    expect(requests.find((r) => r.url.pathname === "/auth/v1/user")?.headers.get("authorization")).toBe(`Bearer ${token}`);
    // Never a secret key: every request carries only the publishable key.
    expect(requests.every((r) => r.headers.get("apikey") === PUBLISHABLE_KEY)).toBe(true);
  });

  test("with the @supabase/ssr session cookie when there is no Authorization header", async () => {
    const token = await aal2(USERS.county);
    const cookie = sessionCookie(token);
    expect(cookie.name).toBe(AUTH_COOKIE);
    const { result, requests } = await check(new Request(URL_BASE), {
      extra: { cookies: async () => ({ getAll: () => [cookie] }) },
    });
    expect(result).toEqual({ ok: true, official: { userId: USERS.county, role: "county", scope: "county", scopeId: "18097" } });
    expect(requests.find((r) => r.url.pathname === "/rest/v1/official_roles")?.headers.get("authorization")).toBe(
      `Bearer ${token}`,
    );
  });

  test("a trailing slash on the Supabase URL is fine", async () => {
    const { result } = await check(bearer(await aal2(USERS.state)), {
      extra: { env: { ...ENV, NEXT_PUBLIC_SUPABASE_URL: `${ENV.NEXT_PUBLIC_SUPABASE_URL}/` } },
    });
    expect(result.ok).toBe(true);
  });
});

describe("AC2: a poll worker can't act outside their precinct", () => {
  const precinct = (id: string): OfficialTarget => ({ scope: "precinct", id });
  const county = (id: string): OfficialTarget => ({ scope: "county", id });

  test.each([
    // [user, target, allowed]
    ["pollWorker", precinct("18097-001"), true],
    ["pollWorker", precinct("18097-002"), false],
    ["pollWorker", precinct("18057-001"), false],
    ["pollWorker", county("18097"), false],
    ["pollWorker", precinct("99999-001"), false],
    ["county", precinct("18097-001"), true],
    ["county", precinct("18097-002"), true],
    ["county", county("18097"), true],
    ["county", precinct("18057-001"), false],
    ["county", county("18057"), false],
    ["county", precinct("99999-001"), false],
    ["state", precinct("18097-001"), true],
    ["state", precinct("18057-001"), true],
    ["state", county("18057"), true],
    ["state", precinct("99999-001"), false],
    ["state", county("99999"), false],
  ] as Array<[keyof typeof USERS, OfficialTarget, boolean]>)("%s on %j: allowed %s", async (user, target, allowed) => {
    const { result } = await check(bearer(await aal2(USERS[user])), { target });
    expect(result.ok).toBe(allowed);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  test("a poll worker with no target passes the role check only", async () => {
    const { result, requests } = await check(bearer(await aal2(USERS.pollWorker)));
    expect(result.ok).toBe(true);
    expect(requests.some((r) => r.url.pathname === "/rest/v1/precincts")).toBe(false);
  });

  test("a role not in the endpoint's allowed list gets 403", async () => {
    await expectForbidden(check(bearer(await aal2(USERS.pollWorker)), { roles: ["county", "state"] }));
    await expectForbidden(check(bearer(await aal2(USERS.county)), { roles: ["state"] }));
    const { result } = await check(bearer(await aal2(USERS.state)), { roles: ["state"] });
    expect(result.ok).toBe(true);
  });

  test("a failed precinct lookup is a 403, not a pass", async () => {
    await expectForbidden(check(bearer(await aal2(USERS.state)), { target: precinct("18097-001"), options: { precinctsStatus: 500 } }));
    await expectForbidden(
      check(bearer(await aal2(USERS.state)), { target: precinct("18097-001"), options: { networkFailure: /precincts/ } }),
    );
  });
});

describe("parseTarget", () => {
  const parse = (query: string) => parseTarget(new URLSearchParams(query));

  test("reads one precinct or one county", () => {
    expect(parse("")).toBeUndefined();
    expect(parse("other=1")).toBeUndefined();
    expect(parse("precinct=18097-001")).toEqual({ scope: "precinct", id: "18097-001" });
    expect(parse("county=%2018097%20")).toEqual({ scope: "county", id: "18097" });
  });

  test.each(["precinct=", "county=%20", "precinct=a&county=b", "precinct=a&precinct=b", `precinct=${"x".repeat(65)}`])(
    "refuses %s",
    (query) => {
      expect(parse(query)).toBeNull();
    },
  );
});

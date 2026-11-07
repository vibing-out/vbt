import { afterEach, expect, test, vi } from "vitest";
import { countContextEntries, parseCorrection, recentCorrections } from "./context-log";

const env = {
  CONTEXT_SUPABASE_URL: "https://context.example.co/",
  CONTEXT_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ctx",
  CONTEXT_EMAIL: "agent@example.com",
  CONTEXT_PASSWORD: "pw",
};

afterEach(() => vi.unstubAllGlobals());

function mockSupabase(rows: unknown) {
  const fetchMock = vi.fn(async (url: string) =>
    url.includes("/auth/v1/token") ? Response.json({ access_token: "jwt-123" }) : Response.json(rows),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

test("signs in with the password grant, then calls search_context with the token", async () => {
  const fetchMock = mockSupabase([{ id: 1 }, { id: 2 }, { id: 3 }]);

  expect(await countContextEntries(env)).toBe(3);

  expect(fetchMock).toHaveBeenCalledTimes(2);
  const [signInUrl, signIn] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(signInUrl).toBe("https://context.example.co/auth/v1/token?grant_type=password");
  expect(signIn.method).toBe("POST");
  expect(signIn.headers).toMatchObject({ apikey: "sb_publishable_ctx" });
  expect(JSON.parse(signIn.body as string)).toEqual({ email: "agent@example.com", password: "pw" });

  const [rpcUrl, rpc] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
  expect(rpcUrl).toBe("https://context.example.co/rest/v1/rpc/search_context");
  expect(rpc.method).toBe("POST");
  expect(rpc.headers).toMatchObject({ apikey: "sb_publishable_ctx", Authorization: "Bearer jwt-123" });
  expect(JSON.parse(rpc.body as string)).toMatchObject({ p_query: "" });
});

test("returns 0 for an empty log", async () => {
  mockSupabase([]);
  expect(await countContextEntries(env)).toBe(0);
});

test.each(Object.keys(env))("returns null without any call when %s is missing", async (name) => {
  const fetchMock = mockSupabase([]);
  expect(await countContextEntries({ ...env, [name]: "" })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("does not read the scripts' SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY names", async () => {
  const fetchMock = mockSupabase([]);
  const { CONTEXT_SUPABASE_URL: _u, CONTEXT_SUPABASE_PUBLISHABLE_KEY: _k, ...rest } = env;
  void _u; void _k;
  expect(await countContextEntries({ ...rest, SUPABASE_URL: "https://x", SUPABASE_PUBLISHABLE_KEY: "y" })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("returns null when sign-in fails, and does not call the RPC", async () => {
  const fetchMock = vi.fn(async () => new Response("bad", { status: 400 }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await countContextEntries(env)).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("returns null (not 0) when sign-in succeeds but search_context fails", async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url.includes("/auth/v1/token")
      ? Response.json({ access_token: "jwt-123" })
      : Response.json({ message: "internal error" }, { status: 500 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  expect(await countContextEntries(env)).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("returns null (not 0) when search_context returns a non-list", async () => {
  const fetchMock = mockSupabase({ id: 1 });
  expect(await countContextEntries(env)).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

const correctionRow = {
  id: 42,
  created_at: "2026-11-07T15:04:05Z",
  topic: "T-04",
  body: "Cast order came from the base table | caught by: code reviewer | fix: read it from the view | evidence: review comment",
};

test("recentCorrections asks search_context for corrections only and splits each body", async () => {
  const fetchMock = mockSupabase([correctionRow]);
  expect(await recentCorrections(5, env)).toEqual([
    {
      id: 42,
      date: "2026-11-07",
      topic: "T-04",
      claim: "Cast order came from the base table",
      caughtBy: "code reviewer",
      fix: "read it from the view",
    },
  ]);
  const [, rpc] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
  expect(JSON.parse(rpc.body as string)).toMatchObject({ p_type: "correction", p_limit: 5 });
});

test("recentCorrections skips a row whose body is not in the stored shape", async () => {
  mockSupabase([correctionRow, { id: 7, body: "free text with no parts" }, { body: "no id | caught by: x | fix: y" }]);
  expect((await recentCorrections(5, env))?.map((c) => c.id)).toEqual([42]);
});

test("recentCorrections returns null (not an empty list) when the log can't be read", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
  expect(await recentCorrections(5, env)).toBeNull();
  expect(await recentCorrections(5, {})).toBeNull();
});

test("parseCorrection keeps a pipe inside the claim and tolerates a missing evidence part", () => {
  expect(parseCorrection({ id: 1, body: "a | b claim | caught by: test | fix: guard" })).toMatchObject({
    claim: "a | b claim",
    caughtBy: "test",
    fix: "guard",
    date: "",
    topic: "",
  });
});

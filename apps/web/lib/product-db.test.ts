import { afterEach, expect, test, vi } from "vitest";
import { readGreeting } from "./product-db";

const env = { NEXT_PUBLIC_SUPABASE_URL: "https://product.example.co/", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" };

afterEach(() => vi.unstubAllGlobals());

test("reads the greeting from app_info with only the two product names and the publishable key", async () => {
  const fetchMock = vi.fn(async () => Response.json([{ value: "Hello, VBT" }]));
  vi.stubGlobal("fetch", fetchMock);

  // Context-log secrets in the same env must not be used.
  const greeting = await readGreeting({ ...env, CONTEXT_PASSWORD: "secret", SUPABASE_SECRET_KEY: "nope" });

  expect(greeting).toBe("Hello, VBT");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://product.example.co/rest/v1/app_info?key=eq.greeting&select=value");
  expect(init.headers).toEqual({ apikey: "sb_publishable_x", Authorization: "Bearer sb_publishable_x" });
  expect(JSON.stringify(init)).not.toMatch(/secret|nope/);
});

test("returns null without calling fetch when the env is missing", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(await readGreeting({ NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("returns null on an error response, an empty result or a network failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 401 })));
  expect(await readGreeting(env)).toBeNull();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
  expect(await readGreeting(env)).toBeNull();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
  expect(await readGreeting(env)).toBeNull();
});

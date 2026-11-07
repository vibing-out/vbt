import { createAccessProof } from "flags";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// A throwaway secret for this test only; never a real FLAGS_SECRET.
const secret = Buffer.alloc(32, 7).toString("base64url");
const keys = ["mismatch-view", "challenge-discard-flow", "state-level-status"];

const { GET } = await import("./route");
const get = (authorization?: string) =>
  GET(
    new Request("http://localhost/.well-known/vercel/flags", {
      headers: authorization ? { authorization } : {},
    }) as unknown as NextRequest,
  );

beforeEach(() => {
  vi.stubEnv("FLAGS_SECRET", secret);
  // No SDK key, as in CI: the route falls back to the flags as declared in code.
  vi.stubEnv("FLAGS", "");
});
afterEach(() => vi.unstubAllEnvs());

test("without an Authorization header it returns 401 and no flag definitions", async () => {
  const res = await get();
  expect(res.status).toBe(401);
  const body = await res.text();
  for (const key of keys) expect(body).not.toContain(key);
});

test("with a proof made from another secret it returns 401 and no flag definitions", async () => {
  const res = await get(`Bearer ${await createAccessProof(Buffer.alloc(32, 9).toString("base64url"))}`);
  expect(res.status).toBe(401);
  const body = await res.text();
  for (const key of keys) expect(body).not.toContain(key);
});

test("with a garbage Authorization header it returns 401", async () => {
  expect((await get("Bearer not-a-proof")).status).toBe(401);
});

test("when FLAGS_SECRET is unset it returns 401, even with a header", async () => {
  const proof = await createAccessProof(secret);
  vi.stubEnv("FLAGS_SECRET", "");
  const res = await get(`Bearer ${proof}`);
  expect(res.status).toBe(401);
  expect(await res.text()).not.toContain("mismatch-view");
});

test("with a valid proof built from FLAGS_SECRET it lists all three flags", async () => {
  const res = await get(`Bearer ${await createAccessProof(secret)}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(res.headers.get("cache-control")).toBe("no-store");
  const { definitions } = (await res.json()) as {
    definitions: Record<string, { defaultValue: unknown; description?: string }>;
  };
  expect(Object.keys(definitions).sort()).toEqual([...keys].sort());
  for (const key of keys) {
    expect(definitions[key].defaultValue, key).toBe(true);
    expect(definitions[key].description, key).toBeTruthy();
  }
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

// AC1 (T-20): every official endpoint goes through requireRole, so an unauthenticated or single-factor
// session gets 403 on each of them. Only the anonymous public endpoints in the locked API table may
// skip it: the tracker, the published record and the SMS webhook (which checks the provider signature).
const API = import.meta.dirname;
const PUBLIC_PREFIXES = ["track/", "record/", "sms/"];
const HANDLER = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return /^route\.(ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

const routes = routeFiles(API).map((file) => relative(API, file));
const officialRoutes = routes.filter((route) => !PUBLIC_PREFIXES.some((prefix) => route.startsWith(prefix)));

test("there is at least one official route (the T-20 probe)", () => {
  expect(officialRoutes).toContain(join("official", "whoami", "route.ts"));
});

test.each(officialRoutes)("%s: every exported handler calls requireRole", (route) => {
  const source = readFileSync(join(API, route), "utf8");
  expect(source).toMatch(/import\s*\{[^}]*\brequireRole\b[^}]*\}\s*from\s*["'][./]*lib\/require-role["']/);
  // Handlers must be function declarations, so each one can be checked (no `export const GET = ...`).
  expect(source).not.toMatch(/export\s+(const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/);
  expect(source).not.toMatch(/export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/);
  const starts = [...source.matchAll(HANDLER)].map((m) => m.index);
  expect(starts.length).toBeGreaterThan(0);
  starts.forEach((start, i) => {
    const body = source.slice(start, starts[i + 1] ?? source.length);
    expect(body, `handler ${i + 1} in ${route}`).toMatch(/\brequireRole\(/);
  });
});

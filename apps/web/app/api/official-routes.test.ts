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

const CALL = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+requireRole\(/g;
// Escapes every regular-expression metacharacter, backslash included (an identifier can only hold `$`
// today, but a partial escape breaks as soon as the pattern changes).
const escape = (name: string) => name.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");

/**
 * Why a handler body does not use requireRole's result, or null when it does. Requires exactly one
 * `const <name> = await requireRole(...)` and, as the very next statement,
 * `if (!<name>.ok) return <name>.response;` so a handler can't ignore a refusal.
 */
function guardProblem(body: string): string | null {
  const calls = [...body.matchAll(CALL)];
  if (calls.length !== 1 || body.match(/\brequireRole\(/g)?.length !== 1) {
    return "expected exactly one `const <name> = await requireRole(...)`";
  }
  const name = escape(calls[0]![1]!);
  const after = body.slice(calls[0]!.index);
  const next = after.slice(after.indexOf(";") + 1).trimStart();
  const guard = new RegExp(`^if\\s*\\(\\s*!\\s*${name}\\.ok\\s*\\)\\s*(?:\\{\\s*)?return\\s+${name}\\.response\\s*[;}\\n]`);
  return guard.test(next) ? null : `expected \`if (!${calls[0]![1]}.ok) return ${calls[0]![1]}.response\` right after requireRole`;
}

test.each([
  ["the result is ignored", "const auth = await requireRole(request, ROLES);\n  return Response.json({});"],
  ["the call is not kept", "await requireRole(request, ROLES);\n  return Response.json({});"],
  ["another name is checked", "const auth = await requireRole(request, ROLES);\n  if (!other.ok) return other.response;"],
  ["a different response is returned", "const auth = await requireRole(request, ROLES);\n  if (!auth.ok) return Response.json({});"],
  ["work runs before the guard", "const auth = await requireRole(request, ROLES);\n  await write();\n  if (!auth.ok) return auth.response;"],
  ["the guard is inverted", "const auth = await requireRole(request, ROLES);\n  if (auth.ok) return auth.response;"],
  ["requireRole is called twice", "const auth = await requireRole(request, ROLES);\n  if (!auth.ok) return auth.response;\n  requireRole(request, ROLES);"],
])("the guard check rejects a handler where %s", (_name, body) => {
  expect(guardProblem(body)).not.toBeNull();
});

test.each([
  "const auth = await requireRole(request, ROLES, target);\n  if (!auth.ok) return auth.response;\n  return Response.json({});",
  "const gate = await requireRole(request, ROLES);\n  if (!gate.ok) {\n    return gate.response;\n  }",
])("the guard check accepts %j", (body) => {
  expect(guardProblem(body)).toBeNull();
});

test.each(officialRoutes)("%s: every exported handler calls requireRole and returns its refusal", (route) => {
  const source = readFileSync(join(API, route), "utf8");
  expect(source).toMatch(/import\s*\{[^}]*\brequireRole\b[^}]*\}\s*from\s*["'][./]*lib\/require-role["']/);
  // Handlers must be function declarations, so each one can be checked (no `export const GET = ...`).
  expect(source).not.toMatch(/export\s+(const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/);
  expect(source).not.toMatch(/export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/);
  const starts = [...source.matchAll(HANDLER)].map((m) => m.index);
  expect(starts.length).toBeGreaterThan(0);
  starts.forEach((start, i) => {
    const body = source.slice(start, starts[i + 1] ?? source.length);
    expect(guardProblem(body), `handler ${i + 1} in ${route}`).toBeNull();
  });
});

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const serverModules = ["lib/product-db.ts", "lib/context-log.ts", "lib/require-role.ts", "lib/factory-stats.ts"];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if ([".next", "node_modules", "e2e"].includes(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

test.each(serverModules)("%s is marked server-only, so a client import fails the build", (file) => {
  expect(readFileSync(join(root, file), "utf8")).toMatch(/^import "server-only";/m);
});

test("only the server-only context-log module reads CONTEXT_* names, and no client component imports the DB modules", () => {
  for (const file of sourceFiles(root)) {
    const source = readFileSync(join(file), "utf8");
    const rel = relative(root, file);
    if (/CONTEXT_(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|EMAIL|PASSWORD)/.test(source)) expect(rel).toBe("lib/context-log.ts");
    if (/^\s*["']use client["']/m.test(source)) expect(source).not.toMatch(/product-db|context-log|require-role/);
  }
});

// After `next build`, scan what the browser downloads. The source checks above stop a client import;
// this proves the built client bundle holds none of the context-log reader (skipped before a build).
const staticDir = join(root, ".next", "static");
test.skipIf(!existsSync(staticDir))("the built client bundle contains no context-log reader code or CONTEXT_* names", () => {
  const files = sourceFilesIn(staticDir);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    expect(source, relative(root, file)).not.toMatch(/search_context|grant_type=password|CONTEXT_(SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|EMAIL|PASSWORD)/);
  }
});

function sourceFilesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFilesIn(path);
    return /\.(js|mjs|css|html|json)$/.test(name) ? [path] : [];
  });
}

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const serverModules = [
  "lib/product-db.ts",
  "lib/context-log.ts",
  "lib/require-role.ts",
  "lib/private-db.ts",
  "lib/mismatch-report.ts",
  // T-09: the service-role database, the crypto adapter (election keys) and the official tools.
  "lib/service-db.ts",
  "lib/official-db.ts",
  "lib/crypto/index.ts",
  "lib/batches.ts",
  "lib/challenges.ts",
  "lib/mismatches.ts",
  "lib/uploads.ts",
  "lib/page-guard.ts",
  "lib/track/lookup.ts",
  "lib/election.ts",
  "lib/ingest.ts",
];

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
    if (/^\s*["']use client["']/m.test(source)) {
      expect(source).not.toMatch(/product-db|context-log|require-role|private-db|mismatch-report|track\/lookup|track\/handler/);
      // T-09 server modules, by import path (a client form may still name its /api/batches URL).
      expect(source).not.toMatch(/from\s+["'][^"']*lib\/(service-db|crypto|batches|challenges|mismatches|uploads|page-guard)\b/);
    }
  }
});

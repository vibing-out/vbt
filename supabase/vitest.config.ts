import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// DATABASE_URL may live in the repo's .env.local; variables already set (CI) win.
const envLocal = new URL("../.env.local", import.meta.url);
if (existsSync(envLocal)) process.loadEnvFile(envLocal);

export default defineConfig({
  resolve: {
    // batch-rpc.test.ts builds its Merkle tree with apps/web/lib/batches.ts, which imports "server-only";
    // that throws outside a React Server Components bundle, so use its no-op entry (as apps/web's tests do).
    alias: { "server-only": fileURLToPath(new URL("../apps/web/node_modules/server-only/empty.js", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});

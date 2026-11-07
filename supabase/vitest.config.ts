import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// DATABASE_URL may live in the repo's .env.local; variables already set (CI) win.
const envLocal = new URL("../.env.local", import.meta.url);
if (existsSync(envLocal)) process.loadEnvFile(envLocal);

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});

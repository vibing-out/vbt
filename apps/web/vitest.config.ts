import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // "server-only" throws outside a React Server Components bundle; tests run in Node, so use its no-op entry.
    alias: { "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)) },
  },
  test: {
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
  },
});

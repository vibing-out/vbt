import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/status.ts", "src/transition.ts", "src/official.ts", "src/manifest.ts", "src/timeline.ts"],
      reporter: ["text"],
      // The transition rules, the official scope rule and the ballot choice rules are the source of truth; every
      // branch must be exercised.
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});

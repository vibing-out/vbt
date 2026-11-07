import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // T-10's importers; T-05's modules have their own tests without a coverage gate.
      include: ["src/event-types.ts", "src/nist-codes.ts", "src/parse.ts", "src/cdf-log*.ts", "src/results-1500-100.ts"],
      exclude: ["src/*.test.ts", "src/index.ts"],
      reporter: ["text"],
      // The importers decide what the cross-checks see; every branch must be exercised.
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});

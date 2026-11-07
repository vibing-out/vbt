import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // The T-10 importers and their tables. The rest of the package (the T-05 chain, leaves and
      // record file) is tested by its own suites without a coverage gate.
      include: [
        "src/event-types.ts",
        "src/nist-codes.ts",
        "src/parse.ts",
        "src/cdf-log.ts",
        "src/cdf-log-json.ts",
        "src/cdf-log-xml.ts",
        "src/results-1500-100.ts",
      ],
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

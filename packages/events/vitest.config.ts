import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Scoped to the machine-log and results importers; the chain, hash and record-file modules are
      // tested without this gate.
      include: [
        "src/cdf-log.ts",
        "src/cdf-log-json.ts",
        "src/cdf-log-xml.ts",
        "src/event-types.ts",
        "src/nist-codes.ts",
        "src/parse.ts",
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

import { flag } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";

// Smoke test that Vercel Flags evaluates here (on in development and preview, off in production).
// Remove when T-13 adds the real flags.
export const pipelineSmoke = flag<boolean>({
  key: "pipeline-smoke",
  adapter: vercelAdapter(),
  defaultValue: false,
});

import { expect, test } from "vitest";
import { protectionBypassHeaders } from "./playwright.bypass";

// AC3 (T-20): the demo sign-in spec must reach a protected Vercel preview, not its SSO redirect.
test("sends x-vercel-protection-bypass when VERCEL_AUTOMATION_BYPASS_SECRET is set", () => {
  expect(protectionBypassHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: "s3cret" })).toEqual({
    "x-vercel-protection-bypass": "s3cret",
  });
});

test.each([{}, { VERCEL_AUTOMATION_BYPASS_SECRET: "" }, { VERCEL_AUTOMATION_BYPASS_SECRET: "  " }])(
  "sends no bypass header when the secret is unset (%j)",
  (env) => {
    expect(protectionBypassHeaders(env)).toBeUndefined();
  },
);

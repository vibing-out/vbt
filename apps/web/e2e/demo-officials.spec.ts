import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import * as OTPAuth from "otpauth";

// T-20 AC3: each seeded demo official signs in on a deployed preview with email, password and TOTP.
// Run with PLAYWRIGHT_BASE_URL=<preview url>, the DEMO_* secrets and, for a protected preview,
// VERCEL_AUTOMATION_BYPASS_SECRET (playwright.config.ts sends it as x-vercel-protection-bypass). All are
// Vercel/Warp secrets only, never the repo; supabase/scripts/seed-demo-officials.ts creates the accounts
// and prints the TOTP secrets.
// Skipped, not silently passed, when that env is missing.
const ACCOUNTS = [
  { prefix: "DEMO_POLL_WORKER", role: "poll_worker", scope: "precinct" },
  { prefix: "DEMO_COUNTY", role: "county", scope: "county" },
  { prefix: "DEMO_STATE", role: "state", scope: null },
] as const;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const preview = process.env.PLAYWRIGHT_BASE_URL;

for (const { prefix, role, scope } of ACCOUNTS) {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  const secret = process.env[`${prefix}_TOTP_SECRET`];

  test(`the ${role} demo account signs in with TOTP and reaches aal2 @smoke`, async ({ request }) => {
    test.skip(!preview, "PLAYWRIGHT_BASE_URL (a preview deploy) not set");
    test.skip(!url || !key || !email || !password || !secret, `${prefix}_* or the Supabase env not set`);

    const supabase = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
    const signIn = await supabase.auth.signInWithPassword({ email: email!, password: password! });
    expect(signIn.error).toBeNull();
    const aal1Token = signIn.data.session!.access_token;

    // Password alone is single-factor: refused.
    const single = await request.get("/api/official/whoami", { headers: { Authorization: `Bearer ${aal1Token}` } });
    expect(single.status()).toBe(403);

    const factors = await supabase.auth.mfa.listFactors();
    expect(factors.error).toBeNull();
    const factor = factors.data!.totp[0];
    expect(factor, "a verified TOTP factor").toBeDefined();
    const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret!) }).generate();
    const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: factor!.id, code });
    expect(verified.error).toBeNull();
    const aal2Token = verified.data!.access_token;

    const response = await request.get("/api/official/whoami", { headers: { Authorization: `Bearer ${aal2Token}` } });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { role: string; scope: string | null; scope_id: string | null };
    expect(body.role).toBe(role);
    expect(body.scope).toBe(scope);
    expect(scope === null ? body.scope_id === null : typeof body.scope_id === "string").toBe(true);

    // Only this test session: a global sign-out would end a human's live demo session too.
    await supabase.auth.signOut({ scope: "local" });
  });
}

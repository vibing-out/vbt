// Creates the three T-20 demo officials (poll worker, county, state) in a Supabase project, grants each
// its official_roles row, and enrolls a TOTP factor for each. A human runs it once per project; CI never
// does. It prints the passwords and TOTP secrets it creates, once, to this terminal: store them as
// Vercel and Warp secrets (DEMO_* names in .env.example). It never writes them to a file.
//
// Usage (from supabase/):
//   node scripts/seed-demo-officials.ts --yes [--precinct 18097-001] [--county 18097]
// Env (from the shell or the repo's .env.local): NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY; optional DEMO_{POLL_WORKER,COUNTY,STATE}_EMAIL
// and _PASSWORD (a password is generated when missing).
//
// Re-running is safe: an existing user keeps its account, and a user that already has a verified TOTP
// factor keeps it (its secret is not printed again). Delete the factor in the dashboard to re-enroll.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as OTPAuth from "otpauth";

export type DemoGrant =
  | { role: "poll_worker"; scope: "precinct"; scope_id: string }
  | { role: "county"; scope: "county"; scope_id: string }
  | { role: "state"; scope: null; scope_id: null };

export interface DemoAccount {
  envPrefix: string;
  email: string;
  password: string | undefined;
  grant: DemoGrant;
}

/** Everything the seeding flow does to the project, so the flow can be tested without one. */
export interface SeedOps {
  findUser(email: string): Promise<{ id: string } | null>;
  createUser(email: string, password: string): Promise<{ id: string }>;
  setPassword(userId: string, password: string): Promise<void>;
  upsertGrant(userId: string, grant: DemoGrant): Promise<void>;
  scopeExists(grant: DemoGrant): Promise<boolean>;
  hasVerifiedTotp(userId: string): Promise<boolean>;
  deleteUnverifiedFactors(userId: string): Promise<void>;
  /** Signs in as the user, enrolls TOTP and verifies it with a generated code. Returns the secret. */
  enrollTotp(email: string, password: string): Promise<string>;
}

export const DEFAULT_PRECINCT = "18097-001";
export const DEFAULT_COUNTY = "18097";

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

/** The three demo accounts, from flags and env. Default scopes are supabase/seed.sql's precincts. */
export function demoAccounts(args: readonly string[], env: Readonly<Record<string, string | undefined>>): DemoAccount[] {
  const precinct = flag(args, "--precinct") ?? DEFAULT_PRECINCT;
  const county = flag(args, "--county") ?? DEFAULT_COUNTY;
  const account = (envPrefix: string, defaultEmail: string, grant: DemoGrant): DemoAccount => ({
    envPrefix,
    email: env[`${envPrefix}_EMAIL`] || defaultEmail,
    password: env[`${envPrefix}_PASSWORD`] || undefined,
    grant,
  });
  return [
    account("DEMO_POLL_WORKER", "poll-worker.demo@vbt.example", { role: "poll_worker", scope: "precinct", scope_id: precinct }),
    account("DEMO_COUNTY", "county.demo@vbt.example", { role: "county", scope: "county", scope_id: county }),
    account("DEMO_STATE", "state.demo@vbt.example", { role: "state", scope: null, scope_id: null }),
  ];
}

export const generatePassword = (): string => randomBytes(24).toString("base64url");

/** The current TOTP code for a base32 secret (RFC 6238 defaults Supabase uses: SHA-1, 6 digits, 30 s). */
export function totpCode(secret: string, timestamp = Date.now()): string {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate({ timestamp });
}

/**
 * Seeds every account. Writes only to `print` (the human's terminal): KEY=value lines for the secrets
 * to store, and notes. Returns nothing, so no caller can persist the secrets by accident.
 */
export async function seedDemoOfficials(
  accounts: readonly DemoAccount[],
  ops: SeedOps,
  print: (line: string) => void,
  newPassword: () => string = generatePassword,
): Promise<void> {
  for (const account of accounts) {
    const { envPrefix, email, grant } = account;
    let password = account.password;
    let printPassword = false;

    let user = await ops.findUser(email);
    if (!user) {
      if (!password) {
        password = newPassword();
        printPassword = true;
      }
      user = await ops.createUser(email, password);
      print(`# ${envPrefix}: created ${email}`);
    } else {
      print(`# ${envPrefix}: ${email} already exists`);
    }

    await ops.upsertGrant(user.id, grant);
    print(`# ${envPrefix}: granted ${grant.role}${grant.scope ? ` on ${grant.scope} ${grant.scope_id}` : " (statewide)"}`);
    if (!(await ops.scopeExists(grant))) {
      print(`# ${envPrefix}: warning: no precinct matches ${grant.scope} ${grant.scope_id} in this project; scoped calls will be refused`);
    }

    print(`${envPrefix}_EMAIL=${email}`);
    if (await ops.hasVerifiedTotp(user.id)) {
      print(`# ${envPrefix}: already has a verified TOTP factor; password and secret left unchanged`);
      continue;
    }

    if (!password) {
      // An existing user with no factor and no known password: set a new one so we can sign in to enroll.
      password = newPassword();
      printPassword = true;
      await ops.setPassword(user.id, password);
    }
    await ops.deleteUnverifiedFactors(user.id);
    const secret = await ops.enrollTotp(email, password);
    if (printPassword) print(`${envPrefix}_PASSWORD=${password}`);
    print(`${envPrefix}_TOTP_SECRET=${secret}`);
  }
}

/** SeedOps against a real project: Auth Admin API with the secret key, the user's own client for TOTP. */
export function supabaseOps(url: string, publishableKey: string, secretKey: string): SeedOps {
  const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
  const admin = createClient(url, secretKey, { auth: noSession });
  const fail = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };

  return {
    async findUser(email) {
      for (let page = 1; ; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        fail("listUsers", error);
        const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
        if (match) return { id: match.id };
        if (data.users.length < 1000) return null;
      }
    },
    async createUser(email, password) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      fail("createUser", error);
      return { id: data.user!.id };
    },
    async setPassword(userId, password) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      fail("updateUserById", error);
    },
    async upsertGrant(userId, grant) {
      const { error } = await admin.from("official_roles").upsert({ user_id: userId, ...grant }, { onConflict: "user_id" });
      fail("upsert official_roles", error);
    },
    async scopeExists(grant) {
      if (grant.scope === null) return true;
      const column = grant.scope === "precinct" ? "id" : "county_id";
      const { data, error } = await admin.from("precincts").select("id").eq(column, grant.scope_id).limit(1);
      fail("read precincts", error);
      return (data ?? []).length > 0;
    },
    async hasVerifiedTotp(userId) {
      const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
      fail("listFactors", error);
      return data!.factors.some((f) => f.factor_type === "totp" && f.status === "verified");
    },
    async deleteUnverifiedFactors(userId) {
      const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
      fail("listFactors", error);
      for (const factor of data!.factors.filter((f) => f.status !== "verified")) {
        const deleted = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
        fail("deleteFactor", deleted.error);
      }
    },
    async enrollTotp(email, password) {
      const user: SupabaseClient = createClient(url, publishableKey, { auth: noSession });
      const signIn = await user.auth.signInWithPassword({ email, password });
      fail("signInWithPassword", signIn.error);
      const enrolled = await user.auth.mfa.enroll({ factorType: "totp", friendlyName: "VBT demo" });
      fail("mfa.enroll", enrolled.error);
      const { id, totp } = enrolled.data!;
      const verified = await user.auth.mfa.challengeAndVerify({ factorId: id, code: totpCode(totp.secret) });
      fail("mfa.challengeAndVerify", verified.error);
      await user.auth.signOut({ scope: "local" });
      return totp.secret;
    },
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (process.env.CI) throw new Error("seed-demo-officials is run by a human, never in CI.");
  const envLocal = new URL("../../.env.local", import.meta.url);
  if (existsSync(envLocal)) process.loadEnvFile(envLocal);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.");
  }
  const accounts = demoAccounts(args, process.env);
  console.log(`Target project: ${new URL(url).host}`);
  for (const a of accounts) console.log(`  ${a.envPrefix}: ${a.email} -> ${a.grant.role} ${a.grant.scope_id ?? "(statewide)"}`);
  if (!args.includes("--yes")) {
    console.log("Dry run. Re-run with --yes to create the accounts and enroll TOTP.");
    return;
  }
  console.log("Store the KEY=value lines below as Vercel and Warp secrets now; they are not saved anywhere.\n");
  await seedDemoOfficials(accounts, supabaseOps(url, publishableKey, secretKey), (line) => console.log(line));
}

// Run only as a script, never on import (the tests import the flow).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch((error: unknown) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}

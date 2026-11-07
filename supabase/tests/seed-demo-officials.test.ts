// T-20 AC3 (demo accounts): the seeding flow, against a fake project. The live sign-in on a preview
// deploy is apps/web/e2e/demo-officials.spec.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toOfficialGrant } from "@vbt/domain";
import { describe, expect, test } from "vitest";
import { SUPABASE_DIR } from "../lib/db.ts";
import {
  DEFAULT_COUNTY,
  DEFAULT_PRECINCT,
  type DemoAccount,
  type DemoGrant,
  demoAccounts,
  generatePassword,
  type SeedOps,
  seedDemoOfficials,
  totpCode,
} from "../scripts/seed-demo-officials.ts";

interface FakeUser {
  id: string;
  email: string;
  password: string;
  factors: Array<{ id: string; status: "verified" | "unverified"; secret: string }>;
}

function fakeProject(existing: FakeUser[] = [], precinctsKnown = true) {
  const users = new Map(existing.map((u) => [u.email, u]));
  const grants = new Map<string, DemoGrant>();
  const calls: string[] = [];
  let n = 0;
  const ops: SeedOps = {
    async findUser(email) {
      const user = users.get(email);
      return user ? { id: user.id } : null;
    },
    async createUser(email, password) {
      calls.push(`createUser ${email}`);
      const user = { id: `user-${++n}`, email, password, factors: [] };
      users.set(email, user);
      return { id: user.id };
    },
    async setPassword(userId, password) {
      calls.push(`setPassword ${userId}`);
      [...users.values()].find((u) => u.id === userId)!.password = password;
    },
    async upsertGrant(userId, grant) {
      grants.set(userId, grant);
    },
    async scopeExists() {
      return precinctsKnown;
    },
    async hasVerifiedTotp(userId) {
      return [...users.values()].find((u) => u.id === userId)!.factors.some((f) => f.status === "verified");
    },
    async deleteUnverifiedFactors(userId) {
      const user = [...users.values()].find((u) => u.id === userId)!;
      user.factors = user.factors.filter((f) => f.status === "verified");
    },
    async enrollTotp(email, password) {
      const user = users.get(email)!;
      if (user.password !== password) throw new Error("signInWithPassword: Invalid login credentials");
      calls.push(`enrollTotp ${email}`);
      const secret = `SECRET${user.id.toUpperCase().replace(/[^A-Z]/g, "")}`;
      user.factors.push({ id: `factor-${user.id}`, status: "verified", secret });
      return secret;
    },
  };
  return { ops, users, grants, calls };
}

async function run(accounts: DemoAccount[], project: ReturnType<typeof fakeProject>) {
  const lines: string[] = [];
  let p = 0;
  await seedDemoOfficials(accounts, project.ops, (line) => lines.push(line), () => `generated-${++p}`);
  return lines;
}

const accounts = (env: Record<string, string> = {}, args: string[] = []) => demoAccounts(args, env);

describe("demo accounts", () => {
  test("are one poll worker, one county official and one state official, scoped to the seed precincts", () => {
    expect(accounts().map((a) => [a.envPrefix, a.grant])).toEqual([
      ["DEMO_POLL_WORKER", { role: "poll_worker", scope: "precinct", scope_id: DEFAULT_PRECINCT }],
      ["DEMO_COUNTY", { role: "county", scope: "county", scope_id: DEFAULT_COUNTY }],
      ["DEMO_STATE", { role: "state", scope: null, scope_id: null }],
    ]);
    // Each grant is a shape requireRole accepts.
    for (const { grant } of accounts()) expect(toOfficialGrant(grant)).not.toBeNull();
  });

  test("take emails and passwords from DEMO_* env, and scopes from flags", () => {
    const list = accounts(
      { DEMO_COUNTY_EMAIL: "c@example.org", DEMO_COUNTY_PASSWORD: "pw" },
      ["--precinct", "18057-001", "--county", "18057"],
    );
    expect(list[0]!.grant).toEqual({ role: "poll_worker", scope: "precinct", scope_id: "18057-001" });
    expect(list[1]).toMatchObject({ email: "c@example.org", password: "pw", grant: { scope_id: "18057" } });
    expect(list[2]!.password).toBeUndefined();
    expect(() => accounts({}, ["--precinct"])).toThrow(/needs a value/);
  });
});

describe("seeding", () => {
  test("creates each account, grants its role, enrolls TOTP and prints each secret once", async () => {
    const project = fakeProject();
    const lines = await run(accounts(), project);

    expect(project.calls.filter((c) => c.startsWith("createUser"))).toHaveLength(3);
    expect([...project.grants.values()].map((g) => g.role)).toEqual(["poll_worker", "county", "state"]);
    for (const prefix of ["DEMO_POLL_WORKER", "DEMO_COUNTY", "DEMO_STATE"]) {
      expect(lines.filter((l) => l.startsWith(`${prefix}_TOTP_SECRET=`))).toHaveLength(1);
      expect(lines.filter((l) => l.startsWith(`${prefix}_PASSWORD=generated-`))).toHaveLength(1);
      expect(lines.filter((l) => l.startsWith(`${prefix}_EMAIL=`))).toHaveLength(1);
    }
    // Every created user can sign in with the printed password and holds a verified factor.
    for (const user of project.users.values()) {
      expect(lines.some((l) => l.endsWith(`_PASSWORD=${user.password}`))).toBe(true);
      expect(user.factors.map((f) => f.status)).toEqual(["verified"]);
    }
  });

  test("a supplied password is used and not printed", async () => {
    const project = fakeProject();
    const lines = await run(accounts({ DEMO_STATE_PASSWORD: "from-env" }), project);
    expect(project.users.get("state.demo@vbt.example")!.password).toBe("from-env");
    expect(lines.some((l) => l.startsWith("DEMO_STATE_PASSWORD="))).toBe(false);
  });

  test("re-running leaves an enrolled official's account, password and factor alone", async () => {
    const project = fakeProject();
    await run(accounts(), project);
    const before = [...project.users.values()].map((u) => ({ ...u, factors: [...u.factors] }));
    project.calls.length = 0;

    const lines = await run(accounts(), project);
    expect(project.calls).toEqual([]);
    expect([...project.users.values()]).toEqual(before);
    expect(lines.some((l) => /_PASSWORD=|_TOTP_SECRET=/.test(l))).toBe(false);
    expect(lines.filter((l) => l.includes("left unchanged"))).toHaveLength(3);
    // The grant is still (re)applied, so a changed scope flag takes effect.
    expect(project.grants.size).toBe(3);
  });

  test("an existing user without a verified factor gets a fresh password and a clean enrollment", async () => {
    const project = fakeProject([
      {
        id: "user-old",
        email: "county.demo@vbt.example",
        password: "forgotten",
        factors: [{ id: "stale", status: "unverified", secret: "STALE" }],
      },
    ]);
    const lines = await run(accounts(), project);
    expect(project.calls).toContain("setPassword user-old");
    expect(project.users.get("county.demo@vbt.example")!.factors.map((f) => f.id)).toEqual(["factor-user-old"]);
    expect(lines).toContain("DEMO_COUNTY_PASSWORD=generated-2");
  });

  test("warns when the scope matches no precinct in the project", async () => {
    const lines = await run(accounts(), fakeProject([], false));
    expect(lines.filter((l) => l.includes("warning: no precinct matches"))).toHaveLength(3);
  });
});

describe("secrets stay out of the repo", () => {
  const script = readFileSync(join(SUPABASE_DIR, "scripts", "seed-demo-officials.ts"), "utf8");

  test("the script writes no files and refuses to run in CI", () => {
    expect(script).not.toMatch(/writeFile|appendFile|createWriteStream/);
    expect(script).toMatch(/if \(process\.env\.CI\) throw/);
  });

  test("CI never runs it", () => {
    const ci = readFileSync(join(SUPABASE_DIR, "..", ".github", "workflows", "ci.yml"), "utf8");
    expect(ci).not.toMatch(/seed-demo-officials|seed:demo-officials/);
  });

  test(".env.example lists the DEMO_* names with no values", () => {
    const example = readFileSync(join(SUPABASE_DIR, "..", ".env.example"), "utf8");
    for (const prefix of ["DEMO_POLL_WORKER", "DEMO_COUNTY", "DEMO_STATE"]) {
      for (const suffix of ["EMAIL", "PASSWORD", "TOTP_SECRET"]) {
        expect(example).toMatch(new RegExp(`^${prefix}_${suffix}=$`, "m"));
      }
    }
  });

  test("generated passwords are long and random", () => {
    const a = generatePassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(generatePassword()).not.toBe(a);
  });
});

test("TOTP codes follow RFC 6238 (SHA-1 test vector, 6 digits)", () => {
  // RFC 6238 Appendix B: secret "12345678901234567890", T = 59 s -> 94287082 (8 digits) -> 287082.
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  expect(totpCode(secret, 59_000)).toBe("287082");
  expect(totpCode(secret, 1_111_111_109_000)).toBe("081804");
});

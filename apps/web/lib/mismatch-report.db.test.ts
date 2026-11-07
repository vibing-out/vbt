import { buildPlan, runSeed } from "@vbt/scale-demo";
import { FAKE_KEY_ENV, fakeCrypto } from "@vbt/scale-demo/testing";
import { describeDb, useScratchDatabase } from "@vbt/scale-demo/testing/db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { readMismatchReport } from "./mismatch-report";
import { closePrivateDb, withServiceRoleReadOnly } from "./private-db";

// AC3 against a real Postgres: the scale seed's writer (fake adapter, 200 ballots, 4 precincts, 5%)
// fills a scratch database, then the report reads it through the real read-only service_role helper.
const OPTIONS = { ballots: 200, precincts: 4, rate: 0.05, seed: "report-db-test" };
const plan = buildPlan(OPTIONS);
const flaggedIn = (precinctId: string) => plan.ballots.filter((b) => b.precinctId === precinctId && b.mismatch).length;

describeDb("the mismatch report on a seeded database", () => {
  const db = useScratchDatabase();
  const read = (scope: Parameters<typeof readMismatchReport>[1]) =>
    withServiceRoleReadOnly((q) => readMismatchReport(q, scope), { PRODUCT_DATABASE_URL: db().url });

  beforeAll(async () => {
    await runSeed({ databaseUrl: db().url, options: OPTIONS, env: FAKE_KEY_ENV }, { crypto: fakeCrypto() });
    // A precinct in another county, with nothing flagged, to prove the county filter.
    await db().client.query("insert into public.precincts (id, county_id, name) values ('OTHER-001', 'OTHER', 'Other 1')");
  });
  afterAll(closePrivateDb);

  test("AC3: every flagged ballot, grouped by precinct, every one CHALLENGED, total 10", async () => {
    const report = await read({ scope: "all" });
    expect(report.total).toBe(10);
    expect(report.precincts.map((p) => p.precinct_id)).toEqual(
      plan.precincts.filter((p) => flaggedIn(p.id) > 0).map((p) => p.id),
    );
    for (const p of report.precincts) {
      expect(p.count).toBe(flaggedIn(p.precinct_id));
      expect(p.ballots).toHaveLength(p.count);
      expect(p.county_id).toBe("SCALE-DEMO");
      for (const b of p.ballots) {
        expect(b.current_status).toBe("CHALLENGED");
        expect(b.cast_date).toBe("2026-11-03");
        expect(Object.keys(b).sort()).toEqual(["ballot_id", "cast_date", "current_status", "tracking_code"]);
      }
      const codes = p.ballots.map((b) => b.tracking_code);
      expect(codes).toEqual([...codes].sort());
    }
    expect(report.precincts.reduce((n, p) => n + p.count, 0)).toBe(report.total);
  });

  test("AC3: the county and precinct scopes filter the report", async () => {
    expect((await read({ scope: "county", id: "SCALE-DEMO" })).total).toBe(10);
    expect(await read({ scope: "county", id: "OTHER" })).toEqual({ precincts: [], total: 0 });
    const precinct = plan.precincts.find((p) => flaggedIn(p.id) > 0)!;
    const one = await read({ scope: "precinct", id: precinct.id });
    expect(one.precincts.map((p) => p.precinct_id)).toEqual([precinct.id]);
    expect(one.total).toBe(flaggedIn(precinct.id));
  });

  test("the report's connection is read-only and runs as service_role", async () => {
    const role = await withServiceRoleReadOnly(async (q) => (await q.query("select current_user as r")).rows[0], {
      PRODUCT_DATABASE_URL: db().url,
    });
    expect(role).toEqual({ r: "service_role" });
    await expect(
      withServiceRoleReadOnly((q) => q.query("update private.ballots set mismatch = false"), { PRODUCT_DATABASE_URL: db().url }),
    ).rejects.toThrow(/read-only transaction/);
    const [{ n }] = (await db().client.query("select count(*)::int as n from private.ballots where mismatch")).rows;
    expect(n).toBe(10);
  });
});

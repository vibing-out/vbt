import { MISMATCH_REASON } from "@vbt/domain";
import { beforeAll, expect, test } from "vitest";
import { buildPlan, COUNTY_ID } from "./plan.ts";
import { FAKE_KEY_ENV, fakeCrypto } from "./testing/fake-crypto.ts";
import { describeDb, useScratchDatabase } from "./testing/scratch-db.ts";
import { AlreadySeededError, runSeed } from "./write.ts";

// AC2 and AC7 against a real Postgres with every migration: a small seed (200 ballots, 4 precincts,
// 5%) written by the real writer with the fake adapter into a scratch database.
const OPTIONS = { ballots: 200, precincts: 4, rate: 0.05, seed: "write-db-test" };

describeDb("the scale seed in a real database", () => {
  const db = useScratchDatabase();
  const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    db().client.query(sql, params).then((r) => r.rows as T[]);

  beforeAll(async () => {
    await runSeed({ databaseUrl: db().url, options: OPTIONS, env: FAKE_KEY_ENV }, { crypto: fakeCrypto() });
  });

  test("AC2: 200 ballots, exactly 10 flagged, every flagged ballot CHALLENGED, every other TALLIED_PRECINCT", async () => {
    const rows = await q<{ current_status: string; mismatch: boolean; n: number }>(
      `select current_status, mismatch, count(*)::int as n from private.ballots group by 1, 2 order by 1`,
    );
    expect(rows).toEqual([
      { current_status: "CHALLENGED", mismatch: true, n: 10 },
      { current_status: "TALLIED_PRECINCT", mismatch: false, n: 190 },
    ]);
  });

  test("AC2: each flagged ballot's events are CAST, MISMATCH_DETECTED, CAST→CHALLENGED, in hash-chain order", async () => {
    const flagged = await q<{ id: string }>("select id from private.ballots where mismatch");
    for (const { id } of flagged) {
      const events = await q<{ event_type: string; from_status: string | null; to_status: string | null; reason: string | null; prev_hash: string | null; hash: string }>(
        "select event_type, from_status, to_status, reason, prev_hash, hash from private.ballot_events where ballot_id = $1",
        [id],
      );
      const chain = [events.find((e) => e.prev_hash === null)!];
      while (chain.length < events.length) chain.push(events.find((e) => e.prev_hash === chain.at(-1)!.hash)!);
      expect(chain.map((e) => [e.event_type, e.from_status, e.to_status, e.reason])).toEqual([
        ["CAST", null, null, null],
        ["MISMATCH_DETECTED", null, null, MISMATCH_REASON],
        ["STATUS_CHANGE", "CAST", "CHALLENGED", MISMATCH_REASON],
      ]);
    }
  });

  test("AC2: one batch and one stage record per precinct, counting the precinct's ballots minus its mismatches", async () => {
    const plan = buildPlan(OPTIONS);
    const rows = await q<{ precinct_id: string; total: number; flagged: number; batch_count: number; record_count: number; batches: number; records: number; batch_events: number }>(
      `select p.id as precinct_id,
              (select count(*)::int from private.ballots b where b.precinct_id = p.id) as total,
              (select count(*)::int from private.ballots b where b.precinct_id = p.id and b.mismatch) as flagged,
              (select count(*)::int from public.batches x where x.scope = 'precinct' and x.scope_id = p.id) as batches,
              (select max(ballot_count) from public.batches x where x.scope_id = p.id) as batch_count,
              (select count(*)::int from public.stage_records r where r.scope = 'precinct' and r.scope_id = p.id) as records,
              (select max(ballot_count) from public.stage_records r where r.scope_id = p.id) as record_count,
              (select count(*)::int from private.ballot_events e join public.batches x on x.id = e.batch_id
                where x.scope_id = p.id) as batch_events
       from public.precincts p where p.county_id = $1 order by p.id`,
      [COUNTY_ID],
    );
    expect(rows.map((r) => r.precinct_id)).toEqual(plan.precincts.map((p) => p.id));
    for (const r of rows) {
      expect(r.batches).toBe(1);
      expect(r.records).toBe(1);
      expect(r.batch_count).toBe(r.total - r.flagged);
      expect(r.record_count).toBe(r.total - r.flagged);
      expect(r.batch_events).toBe(r.total - r.flagged);
    }
    expect(rows.reduce((n, r) => n + r.flagged, 0)).toBe(10);
  });

  test("the public views show the date only, and the seed's ballots through them", async () => {
    const [counts] = await q<{ ballots: number; dates: string[] }>(
      `select (select count(*)::int from public.ballot_public) as ballots,
              (select array_agg(distinct occurred_on::text) from public.ballot_event_public) as dates`,
    );
    expect(counts).toEqual({ ballots: 200, dates: ["2026-11-03"] });
  });

  test("AC7: a second run on the same database is refused and writes nothing", async () => {
    const before = await q<{ n: number }>("select count(*)::int as n from private.ballot_events");
    await expect(
      runSeed({ databaseUrl: db().url, options: OPTIONS, env: FAKE_KEY_ENV }, { crypto: fakeCrypto() }),
    ).rejects.toThrow(AlreadySeededError);
    expect(await q("select count(*)::int as n from private.ballot_events")).toEqual(before);
  });

  test("events stay insert-only after the seed: update and delete still fail", async () => {
    for (const sql of ["update private.ballot_events set reason = 'x'", "delete from private.ballot_events"]) {
      await db().client.query("begin");
      try {
        await expect(db().client.query(sql)).rejects.toThrow(/is insert-only/);
      } finally {
        await db().client.query("rollback");
      }
    }
  });
});

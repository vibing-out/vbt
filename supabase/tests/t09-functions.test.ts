// T-09 (#19): the official database functions (AC1, AC1b–d, AC3, AC4, AC5, AC7).
import { createHash } from "node:crypto";
import type pg from "pg";
import { expect, test } from "vitest";
import { asRole, describeDb, PERMISSION_DENIED, useScratchDatabase } from "./support.ts";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const ACTOR = "00000000-0000-4000-8000-000000000001";
const COUNTY_ACTOR = "00000000-0000-4000-8000-000000000002";
const RECORD = (count: number) => ({ merkle_root: "b".repeat(64), ballot_count: count, totals: { p: { a: count } }, signature: "c2lnbmF0dXJl" });
const UPLOADS = [{ file_sha256: "d".repeat(64), kind: "machine_log", scope_id: "18097-001" }];
const NEW_FUNCTIONS = [
  "official_ballot_scope",
  "official_batch_ballots",
  "official_challenge_removed",
  "official_machine_ballot_counts",
  "official_mismatches",
  "official_record_uploads",
  "official_resolve_challenge",
  "official_run_batch",
  "official_stage_totals",
  "official_status_counts",
];

type Q = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;

/** Runs `body` as service_role in a transaction that is always rolled back. */
async function asService(client: pg.Client, body: (q: Q) => Promise<void>): Promise<void> {
  await client.query("begin");
  try {
    await client.query("set local role service_role");
    await body((sql, params = []) => client.query(sql, params));
  } finally {
    await client.query("rollback");
  }
}

/** Expects `sql` to fail, and rolls back only that statement so the transaction can be inspected. */
async function expectFailure(q: Q, sql: string, params: unknown[], message: RegExp, code?: string): Promise<void> {
  await q("savepoint attempt");
  let error: (Error & { code?: string }) | undefined;
  try {
    await q(sql, params);
  } catch (caught) {
    error = caught as Error & { code?: string };
  }
  await q("rollback to savepoint attempt");
  expect(error?.message).toMatch(message);
  if (code) expect(error?.code).toBe(code);
}

const RUN = "select official_run_batch($1, $2, $3, $4, $5, $6, $7::uuid[], $8::jsonb, $9::jsonb, $10::jsonb) as r";

async function ids(q: Q, where: string, params: unknown[] = []): Promise<string[]> {
  const { rows } = await q(`select id from private.ballots where ${where} order by ciphertext_hash, id`, params);
  return rows.map((r: { id: string }) => r.id);
}

async function tallyPrecinct(q: Q, precinct: string, challenge: Array<{ id: string; check: string }> = []) {
  const all = await ids(q, "precinct_id = $1 and current_status = 'CAST'", [precinct]);
  const challenged = new Set(challenge.map((c) => c.id));
  const advance = all.filter((id) => !challenged.has(id));
  const { rows } = await q(RUN, [
    "precinct", precinct, "CAST", "TALLIED_PRECINCT", "poll_worker", ACTOR, advance, JSON.stringify(challenge),
    advance.length ? JSON.stringify(RECORD(advance.length)) : null, JSON.stringify(UPLOADS),
  ]);
  return rows[0].r as { batch_id: string; count: number; challenged: number; stage_record_id: string | null };
}

async function countyBatch(q: Q, from: string, to: string) {
  const advance = await ids(q, "current_status = $1 and precinct_id in (select id from public.precincts where county_id = '18097')", [from]);
  const { rows } = await q(RUN, ["county", "18097", from, to, "county", COUNTY_ACTOR, advance, "[]", JSON.stringify(RECORD(advance.length)), "[]"]);
  return rows[0].r as { batch_id: string; count: number; stage_record_id: string };
}

/** Recomputes every event hash of a ballot from the public view, following prev_hash from the CAST event. */
async function expectChainRecomputes(q: Q, ballotId: string): Promise<string[]> {
  const { rows } = await q(
    `select e.event_type, e.from_status, e.to_status, e.prev_hash, e.hash, to_char(e.occurred_on, 'YYYY-MM-DD') as day,
            b.tracking_code
     from ballot_event_public e join ballot_public b on b.id = e.ballot_id where e.ballot_id = $1`,
    [ballotId],
  );
  const cast = rows.find((r) => r.event_type === "CAST");
  expect(cast.hash).toBe(sha256(`CAST:${cast.tracking_code}`));
  const types = ["CAST"];
  let head = cast;
  for (let next = rows.find((r) => r.prev_hash === head.hash); next; next = rows.find((r) => r.prev_hash === head.hash)) {
    expect(next.hash).toBe(sha256(`${next.prev_hash}:${next.event_type}:${next.from_status}:${next.to_status}:${next.day}`));
    types.push(`${next.event_type}:${next.to_status}`);
    head = next;
  }
  expect(types).toHaveLength(rows.length);
  return types;
}

describeDb("official_run_batch", () => {
  const db = useScratchDatabase({ seed: true });

  test("AC1: tallies all 17 ballots of 18097-001 in one call, with events, a stage record and upload hashes", async () => {
    await asService(db(), async (q) => {
      const result = await tallyPrecinct(q, "18097-001");
      expect(result.count).toBe(17);
      expect(result.challenged).toBe(0);

      const statuses = await q("select current_status, count(*)::int as n from private.ballots where precinct_id = '18097-001' group by 1");
      expect(statuses.rows).toEqual([{ current_status: "TALLIED_PRECINCT", n: 17 }]);
      const batches = await q("select scope, scope_id, from_status, to_status, actor_id, ballot_count from public.batches");
      expect(batches.rows).toEqual([
        { scope: "precinct", scope_id: "18097-001", from_status: "CAST", to_status: "TALLIED_PRECINCT", actor_id: ACTOR, ballot_count: 17 },
      ]);
      const events = await q("select count(*)::int as n from private.ballot_events where event_type = 'STATUS_CHANGE' and batch_id = $1", [result.batch_id]);
      expect(events.rows[0].n).toBe(17);
      const records = await q("select id, scope, scope_id, stage, merkle_root, ballot_count, signature from public.stage_records");
      expect(records.rows).toEqual([
        { id: result.stage_record_id, scope: "precinct", scope_id: "18097-001", stage: "TALLIED_PRECINCT", merkle_root: "b".repeat(64), ballot_count: 17, signature: "c2lnbmF0dXJl" },
      ]);
      const uploads = await q("select file_sha256, kind, scope_id, uploaded_by from private.uploads");
      expect(uploads.rows).toEqual([{ ...UPLOADS[0], uploaded_by: ACTOR }]);

      for (const id of await ids(q, "precinct_id = '18097-001'")) {
        expect(await expectChainRecomputes(q, id)).toEqual(["CAST", "STATUS_CHANGE:TALLIED_PRECINCT"]);
      }
      // Other precincts are untouched.
      const other = await q("select count(*)::int as n from private.ballots where precinct_id <> '18097-001' and current_status <> 'CAST'");
      expect(other.rows[0].n).toBe(0);
    });
  });

  test("AC1b: advancing without a stage record (or with a placeholder) raises and nothing persists", async () => {
    await asService(db(), async (q) => {
      const advance = await ids(q, "precinct_id = '18097-001'");
      const base = ["precinct", "18097-001", "CAST", "TALLIED_PRECINCT", "poll_worker", ACTOR, advance, "[]"];
      for (const record of [null, JSON.stringify({ ...RECORD(17), merkle_root: "placeholder" }), JSON.stringify({ ...RECORD(17), signature: "" }), JSON.stringify(RECORD(16))]) {
        await expectFailure(q, RUN, [...base, record, JSON.stringify(UPLOADS)], /requires a signed stage record/, "VB400");
      }
      const counts = await q(
        `select (select count(*)::int from public.batches) as batches, (select count(*)::int from public.stage_records) as records,
                (select count(*)::int from private.ballot_events where event_type <> 'CAST') as events,
                (select count(*)::int from private.uploads) as uploads,
                (select count(*)::int from private.ballots where current_status <> 'CAST') as moved`,
      );
      expect(counts.rows[0]).toEqual({ batches: 0, records: 0, events: 0, uploads: 0, moved: 0 });
    });
  });

  test("AC1d: a stale set of ballots raises 'stale batch' and is rolled back", async () => {
    await asService(db(), async (q) => {
      const all = await ids(q, "precinct_id = '18097-001'");
      const other = await ids(q, "precinct_id = '18097-002'");
      for (const advance of [all.slice(1), [...all, other[0]], [...all, all[0]], []]) {
        await expectFailure(
          q,
          RUN,
          ["precinct", "18097-001", "CAST", "TALLIED_PRECINCT", "poll_worker", ACTOR, advance, "[]", JSON.stringify(RECORD(advance.length)), "[]"],
          /stale batch/,
          "VB409",
        );
      }
      const moved = await q("select count(*)::int as n from private.ballots where current_status <> 'CAST'");
      expect(moved.rows[0].n).toBe(0);
    });
  });

  test("AC1c: a C1 failure moves only the named ballots to CHALLENGED with mismatch and a public reason", async () => {
    await asService(db(), async (q) => {
      const [first] = await ids(q, "precinct_id = '18097-001'");
      const result = await tallyPrecinct(q, "18097-001", [{ id: first!, check: "C1" }]);
      expect(result).toMatchObject({ count: 16, challenged: 1 });
      const { rows } = await q("select current_status, mismatch from private.ballots where id = $1", [first]);
      expect(rows).toEqual([{ current_status: "CHALLENGED", mismatch: true }]);
      const events = await q("select event_type, from_status, to_status, reason, batch_id from private.ballot_events where ballot_id = $1 and event_type <> 'CAST'", [first]);
      expect(events.rows).toEqual([{ event_type: "MISMATCH_DETECTED", from_status: "CAST", to_status: "CHALLENGED", reason: "Cross-check C1 failed", batch_id: null }]);
      expect(await expectChainRecomputes(q, first!)).toEqual(["CAST", "MISMATCH_DETECTED:CHALLENGED"]);
      const flagged = await q("select count(*)::int as n from private.ballots where mismatch");
      expect(flagged.rows[0].n).toBe(1);
    });
  });

  test("every ballot challenged: a batch row and events, no stage record", async () => {
    await asService(db(), async (q) => {
      const all = await ids(q, "precinct_id = '18057-001'");
      const result = await tallyPrecinct(q, "18057-001", all.map((id) => ({ id, check: "C2" })));
      expect(result).toMatchObject({ count: 0, challenged: 16, stage_record_id: null });
      await expectFailure(
        q,
        RUN,
        ["precinct", "18097-002", "CAST", "TALLIED_PRECINCT", "poll_worker", ACTOR, [], JSON.stringify((await ids(q, "precinct_id = '18097-002'")).map((id) => ({ id, check: "C2" }))), JSON.stringify(RECORD(0)), "[]"],
        /no stage record without ballots/,
        "VB400",
      );
    });
  });

  test("bad input is refused", async () => {
    await asService(db(), async (q) => {
      const all = await ids(q, "precinct_id = '18097-001'");
      const rec = JSON.stringify(RECORD(17));
      for (const [params, message] of [
        [["district", "18097-001", "CAST", "TALLIED_PRECINCT", "poll_worker", ACTOR, all, "[]", rec, "[]"], /scope must be/],
        [["precinct", "18097-001", "CAST", "TALLIED_PRECINCT", "simulator", ACTOR, all, "[]", rec, "[]"], /official actor/],
        [["precinct", "18097-001", "CAST", "TALLIED_PRECINCT", "poll_worker", ACTOR, all.slice(1), JSON.stringify([{ id: all[0], check: "C9" }]), JSON.stringify(RECORD(16)), "[]"], /check C1..C4/],
        [["precinct", "18097-001", "CAST", "TALLIED_PRECINCT", "poll_worker", ACTOR, all, "{}", rec, "[]"], /challenge must be an array/],
      ] as Array<[unknown[], RegExp]>) {
        await expectFailure(q, RUN, params, message, "VB400");
      }
    });
  });

  test("AC3: county election night and certification chain onto the precinct events", async () => {
    await asService(db(), async (q) => {
      await tallyPrecinct(q, "18097-001");
      await tallyPrecinct(q, "18097-002");
      const night = await countyBatch(q, "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL");
      expect(night.count).toBe(34);
      const certified = await countyBatch(q, "REPORTED_UNOFFICIAL", "CERTIFIED");
      expect(certified.count).toBe(34);
      const stages = await q("select scope, scope_id, stage, ballot_count from public.stage_records order by stage, scope_id");
      expect(stages.rows).toEqual([
        { scope: "county", scope_id: "18097", stage: "CERTIFIED", ballot_count: 34 },
        { scope: "county", scope_id: "18097", stage: "REPORTED_UNOFFICIAL", ballot_count: 34 },
        { scope: "precinct", scope_id: "18097-001", stage: "TALLIED_PRECINCT", ballot_count: 17 },
        { scope: "precinct", scope_id: "18097-002", stage: "TALLIED_PRECINCT", ballot_count: 17 },
      ]);
      const [one] = await ids(q, "precinct_id = '18097-002'");
      expect(await expectChainRecomputes(q, one!)).toEqual([
        "CAST",
        "STATUS_CHANGE:TALLIED_PRECINCT",
        "STATUS_CHANGE:REPORTED_UNOFFICIAL",
        "STATUS_CHANGE:CERTIFIED",
      ]);
      // official_stage_totals: the county's precinct records for C3, its own record for C4.
      const c3 = await q("select scope, scope_id, ballot_count from official_stage_totals('county', '18097', 'TALLIED_PRECINCT')");
      expect(c3.rows.map((r) => r.scope_id)).toEqual(["18097-001", "18097-002"]);
      const c4 = await q("select scope, ballot_count, totals from official_stage_totals('county', '18097', 'REPORTED_UNOFFICIAL')");
      expect(c4.rows).toEqual([{ scope: "county", ballot_count: 34, totals: { p: { a: 34 } } }]);
    });
  });
});

describeDb("official_resolve_challenge", () => {
  const db = useScratchDatabase({ seed: true });
  const RESOLVE = "select official_resolve_challenge($1, $2, $3, $4, $5) as status";

  /** Tallies 18097-001 with one ballot challenged for C1, then reports it on election night. */
  async function challengedBallot(q: Q): Promise<string> {
    const [first] = await ids(q, "precinct_id = '18097-001'");
    await tallyPrecinct(q, "18097-001", [{ id: first!, check: "C1" }]);
    return first!;
  }

  test("AC4: rejecting without a reason raises and writes nothing; with a reason gives DISCARDED", async () => {
    await asService(db(), async (q) => {
      const ballot = await challengedBallot(q);
      for (const reason of [null, "", "   "]) {
        await expectFailure(q, RESOLVE, [ballot, "DISCARDED", reason, "county", COUNTY_ACTOR], /requires a reason/, "VB400");
      }
      const before = await q("select count(*)::int as n from private.ballot_events where ballot_id = $1", [ballot]);
      expect(before.rows[0].n).toBe(2);

      const { rows } = await q(RESOLVE, [ballot, "DISCARDED", "Ballot not on the poll book", "county", COUNTY_ACTOR]);
      expect(rows).toEqual([{ status: "DISCARDED" }]);
      const events = await q("select event_type, from_status, to_status, reason from ballot_event_public where ballot_id = $1 and event_type = 'CHALLENGE_RESOLVED'", [ballot]);
      expect(events.rows).toEqual([{ event_type: "CHALLENGE_RESOLVED", from_status: "CHALLENGED", to_status: "DISCARDED", reason: "Ballot not on the poll book" }]);
      expect(await expectChainRecomputes(q, ballot)).toEqual(["CAST", "MISMATCH_DETECTED:CHALLENGED", "CHALLENGE_RESOLVED:DISCARDED"]);
    });
  });

  test("AC4: accepting returns the ballot to the status held before the challenge, and only that one", async () => {
    await asService(db(), async (q) => {
      const ballot = await challengedBallot(q);
      const scope = await q("select * from official_ballot_scope($1)", [ballot]);
      expect(scope.rows).toEqual([{ precinct_id: "18097-001", county_id: "18097", current_status: "CHALLENGED", held_status: "CAST" }]);
      await expectFailure(q, RESOLVE, [ballot, "TALLIED_PRECINCT", null, "county", COUNTY_ACTOR], /held before/, "VB400");
      const { rows } = await q(RESOLVE, [ballot, "CAST", null, "state", COUNTY_ACTOR]);
      expect(rows).toEqual([{ status: "CAST" }]);
      expect(await expectChainRecomputes(q, ballot)).toEqual(["CAST", "MISMATCH_DETECTED:CHALLENGED", "CHALLENGE_RESOLVED:CAST"]);
      // Back at CAST, it can be tallied in a second precinct batch, chaining on.
      const again = await tallyPrecinct(q, "18097-001");
      expect(again.count).toBe(1);
      expect(await expectChainRecomputes(q, ballot)).toEqual([
        "CAST",
        "MISMATCH_DETECTED:CHALLENGED",
        "CHALLENGE_RESOLVED:CAST",
        "STATUS_CHANGE:TALLIED_PRECINCT",
      ]);
    });
  });

  test("AC4: a ballot that is not challenged, an unknown ballot or a poll worker is refused", async () => {
    await asService(db(), async (q) => {
      const [cast] = await ids(q, "precinct_id = '18097-002'");
      await expectFailure(q, RESOLVE, [cast, "CAST", null, "county", COUNTY_ACTOR], /not challenged/, "VB409");
      await expectFailure(q, RESOLVE, ["00000000-0000-4000-8000-00000000ffff", "CAST", null, "county", COUNTY_ACTOR], /unknown ballot/, "VB404");
      const ballot = await challengedBallot(q);
      await expectFailure(q, RESOLVE, [ballot, "CAST", null, "poll_worker", ACTOR], /county or state/, "VB400");
    });
  });

  test("C4 input: a ballot challenged after election night is listed until it returns", async () => {
    await asService(db(), async (q) => {
      await tallyPrecinct(q, "18097-001");
      await tallyPrecinct(q, "18097-002");
      await countyBatch(q, "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL");
      const [first] = await ids(q, "precinct_id = '18097-001'");
      // An official challenge from REPORTED_UNOFFICIAL, written as T-04 does.
      const head = await q(
        `select hash from private.ballot_events e where ballot_id = $1
         and not exists (select 1 from private.ballot_events n where n.prev_hash = e.hash)`,
        [first],
      );
      await q(
        `insert into private.ballot_events (ballot_id, precinct_id, county_id, event_type, from_status, to_status, actor_role, actor_id, reason, occurred_at, prev_hash, hash)
         values ($1, '18097-001', '18097', 'STATUS_CHANGE', 'REPORTED_UNOFFICIAL', 'CHALLENGED', 'county', 'c', 'Board review', now(), $2, $3)`,
        [first, head.rows[0].hash, "e".repeat(64)],
      );
      await q("update private.ballots set current_status = 'CHALLENGED' where id = $1", [first]);
      const removed = await q("select ciphertext from official_challenge_removed('18097')");
      expect(removed.rows).toHaveLength(1);
      const other = await q("select ciphertext from official_challenge_removed('18057')");
      expect(other.rows).toEqual([]);
    });
  });
});

describeDb("official reads", () => {
  const db = useScratchDatabase({ seed: true });

  test("status counts, batch ballots and machine counts are scoped", async () => {
    await asService(db(), async (q) => {
      expect((await q("select * from official_status_counts('precinct', '18097-001')")).rows).toEqual([{ status: "CAST", n: 17 }]);
      expect((await q("select * from official_status_counts('county', '18097')")).rows).toEqual([{ status: "CAST", n: 34 }]);
      expect((await q("select * from official_status_counts('county', '99999')")).rows).toEqual([]);
      const ballots = await q("select * from official_batch_ballots('county', '18097', 'CAST')");
      expect(ballots.rows).toHaveLength(34);
      const hashes = ballots.rows.map((r) => r.ciphertext_hash);
      expect(hashes).toEqual([...hashes].sort());
      expect(Object.keys(ballots.rows[0]).sort()).toEqual(["ciphertext", "ciphertext_hash", "id", "machine_id"]);
      expect((await q("select * from official_machine_ballot_counts('18097-001')")).rows).toEqual([{ machine_id: "M-18097-001-A", n: 17 }]);
    });
  });

  test("AC5: the mismatch report lists only mismatched or challenged ballots in scope, with a date and no time", async () => {
    await asService(db(), async (q) => {
      const [first] = await ids(q, "precinct_id = '18097-001'");
      await tallyPrecinct(q, "18097-001", [{ id: first!, check: "C1" }]);
      const { rows } = await q("select * from official_mismatches('county', '18097')");
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]).sort()).toEqual(["ballot_id", "current_status", "detected_on", "machine_id", "precinct_id", "reason", "tracking_code"]);
      expect(rows[0]).toMatchObject({ ballot_id: first, precinct_id: "18097-001", machine_id: "M-18097-001-A", current_status: "CHALLENGED", reason: "Cross-check C1 failed" });
      expect(rows[0].detected_on).toBeInstanceOf(Date);
      const result = await q("select pg_get_function_result(oid) as r from pg_proc where proname = 'official_mismatches'");
      expect(result.rows[0].r).toContain("detected_on date");
      expect(result.rows[0].r).not.toMatch(/time/);
      expect((await q("select * from official_mismatches('county', '18057')")).rows).toEqual([]);
      expect((await q("select * from official_mismatches('precinct', '18097-002')")).rows).toEqual([]);
    });
  });
});

describeDb("AC7: only service_role may execute the T-09 functions", () => {
  const db = useScratchDatabase({ seed: true });

  test("the new functions are exactly the expected list, each security invoker with an empty search_path", async () => {
    const { rows } = await db().query(
      `select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'official\\_%' order by 1`,
    );
    expect(rows.map((r) => r.proname)).toEqual(NEW_FUNCTIONS);
    for (const row of rows) {
      expect(row.prosecdef, row.proname).toBe(false);
      expect(row.proconfig, row.proname).toEqual(['search_path=""']);
    }
  });

  test("anon and authenticated have no EXECUTE on any new function, public or private; service_role does", async () => {
    const { rows } = await db().query(
      `select n.nspname || '.' || p.proname as name,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where (n.nspname = 'public' and p.proname like 'official\\_%') or n.nspname = 'private' order by 1`,
    );
    expect(rows.length).toBe(NEW_FUNCTIONS.length + 3);
    for (const row of rows) expect(row, row.name).toMatchObject({ anon: false, authenticated: false, service: true });
  });

  for (const role of ["anon", "authenticated"] as const) {
    test(`${role} gets permission denied calling them`, async () => {
      for (const sql of [
        "select official_status_counts('precinct', '18097-001')",
        "select official_mismatches('county', '18097')",
        "select official_record_uploads('[]'::jsonb, gen_random_uuid())",
        `select official_run_batch('precinct', '18097-001', 'CAST', 'TALLIED_PRECINCT', 'poll_worker', 'x', '{}'::uuid[], '[]', null, '[]')`,
        "select official_resolve_challenge(gen_random_uuid(), 'CAST', null, 'county', 'x')",
      ]) {
        await expect(asRole(db(), role, sql), sql).rejects.toThrow(PERMISSION_DENIED);
      }
    });
  }
});

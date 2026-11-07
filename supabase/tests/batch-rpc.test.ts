import { randomUUID } from "node:crypto";
import { chainEvent, indianaDate, verifyChain } from "@vbt/events";
import { beforeAll, expect, test } from "vitest";
import { chainOf, count, COUNTY, ingestPayload, newBallot, OFFICIAL, PRECINCT, seedPlaces } from "./rpc-fixtures.ts";
import { describeDb, expectStatementError, inRolledBackTransaction, useScratchDatabase } from "./support.ts";

const INGEST = "select public.ingest_ballot_record($1::jsonb) as r";
const MEMBERS = "select public.batch_members($1, $2, $3) as r";
const APPLY = "select public.apply_batch($1::jsonb) as r";

type Member = { ballot_id: string; tracking_code: string; ciphertext_hash: string; head_hash: string | null; heads: number };

const N = 1000;

describeDb("apply_batch (T-05 AC1)", () => {
  const db = useScratchDatabase();
  beforeAll(async () => seedPlaces(db()));

  async function seed(n: number): Promise<void> {
    const ballots = Array.from({ length: n }, (_, i) => newBallot(`B-${String(i).padStart(4, "0")}`));
    await db().query(INGEST, [ingestPayload(ballots)]);
  }

  async function members(): Promise<Member[]> {
    const { rows } = await db().query(MEMBERS, ["precinct", PRECINCT, "CAST"]);
    return rows[0].r as Member[];
  }

  /** The payload apps/web/lib/batches.ts sends, with a placeholder root, totals and signature. */
  function payload(list: Member[], now = new Date()) {
    const occurred_on = indianaDate(now);
    return {
      batch_id: randomUUID(),
      scope: "precinct",
      scope_id: PRECINCT,
      from_status: "CAST",
      to_status: "TALLIED_PRECINCT",
      actor_role: "poll_worker",
      actor_id: OFFICIAL,
      occurred_at: now.toISOString(),
      events: list.map((m) => ({
        ballot_id: m.ballot_id,
        prev_hash: m.head_hash,
        hash: chainEvent(
          {
            tracking_code: m.tracking_code,
            event_type: "STATUS_CHANGE",
            from_status: "CAST",
            to_status: "TALLIED_PRECINCT",
            reason: null,
            occurred_on,
          },
          m.head_hash,
        ).hash,
      })),
      stage_record: { merkle_root: "a".repeat(64), ballot_count: list.length, totals: { c: { x: list.length } }, signature: "c2ln" },
    };
  }

  async function snapshot() {
    return {
      batches: await count(db(), "public.batches"),
      stage_records: await count(db(), "public.stage_records"),
      events: await count(db(), "private.ballot_events"),
      cast: Number((await db().query("select count(*) as n from private.ballots where current_status = 'CAST'")).rows[0].n),
    };
  }

  test("AC1: 1,000 ballots move together, with one event each, one batch and one stage record", async () => {
    await inRolledBackTransaction(db(), "service_role", async () => {
      await seed(N);
      const list = await members();
      expect(list).toHaveLength(N);
      // Ordered by ciphertext hash, never by cast order.
      const hashes = list.map((m) => m.ciphertext_hash);
      expect(hashes).toEqual([...hashes].sort());

      const body = payload(list);
      const { rows } = await db().query(APPLY, [body]);
      expect(rows[0].r).toEqual({ batch_id: body.batch_id, stage_record_id: body.batch_id, ballot_count: N });

      const statuses = await db().query("select current_status, count(*)::int as n from private.ballots group by 1");
      expect(statuses.rows).toEqual([{ current_status: "TALLIED_PRECINCT", n: N }]);

      const events = await db().query(
        `select count(*)::int as n, count(distinct ballot_id)::int as ballots, bool_and(batch_id = $1) as all_in_batch,
                bool_and(actor_role = 'poll_worker' and actor_id = $2 and county_id = $3) as actor_ok
         from private.ballot_events where event_type = 'STATUS_CHANGE'`,
        [body.batch_id, OFFICIAL, COUNTY],
      );
      expect(events.rows).toEqual([{ n: N, ballots: N, all_in_batch: true, actor_ok: true }]);

      const batch = await db().query("select id, scope, scope_id, from_status, to_status, actor_id, ballot_count from public.batches");
      expect(batch.rows).toEqual([
        { id: body.batch_id, scope: "precinct", scope_id: PRECINCT, from_status: "CAST", to_status: "TALLIED_PRECINCT", actor_id: OFFICIAL, ballot_count: N },
      ]);

      const record = await db().query(
        "select id, scope, scope_id, stage, merkle_root, ballot_count, totals, signature, published_at <= now() as published from public.stage_records",
      );
      expect(record.rows).toEqual([
        {
          id: body.batch_id,
          scope: "precinct",
          scope_id: PRECINCT,
          stage: "TALLIED_PRECINCT",
          merkle_root: "a".repeat(64),
          ballot_count: N,
          totals: { c: { x: N } },
          signature: "c2ln",
          published: true,
        },
      ]);
      expect(record.rows[0].merkle_root).toMatch(/^[0-9a-f]{64}$/);

      expect(verifyChain(await chainOf(db(), "B-0042"))).toEqual({ ok: true });
      expect(await members()).toEqual([]);
    });
  });

  test("AC1: a wrong prev_hash raises and changes nothing", async () => {
    await inRolledBackTransaction(db(), "service_role", async () => {
      await seed(20);
      const body = payload(await members());
      body.events[7]!.prev_hash = "0".repeat(64);
      const before = await snapshot();
      await expectStatementError(db(), APPLY, [body], /VB409.*chain head/);
      expect(await snapshot()).toEqual(before);
    });
  });

  test("AC1: a ballot whose status changed after the read raises and changes nothing", async () => {
    await inRolledBackTransaction(db(), "service_role", async () => {
      await seed(20);
      const list = await members();
      await db().query("update private.ballots set current_status = 'CHALLENGED' where id = $1", [list[3]!.ballot_id]);
      const before = await snapshot();
      await expectStatementError(db(), APPLY, [payload(list)], /VB409/);
      expect(await snapshot()).toEqual(before);
    });
  });

  test("a ballot that joined the batch after the read, or a payload missing one, raises", async () => {
    await inRolledBackTransaction(db(), "service_role", async () => {
      await seed(20);
      const list = await members();
      await db().query(INGEST, [ingestPayload([newBallot("LATE-1")])]);
      await expectStatementError(db(), APPLY, [payload(list)], /VB409.*changed since/);
      const all = await members();
      await expectStatementError(db(), APPLY, [payload(all.slice(1))], /VB409/);
      expect(await count(db(), "public.stage_records")).toBe(0);
    });
  });

  test("an empty batch, a ballot listed twice or a wrong ballot_count is refused", async () => {
    await inRolledBackTransaction(db(), "service_role", async () => {
      await seed(3);
      const list = await members();
      await expectStatementError(db(), APPLY, [payload([])], /VB422/);
      await expectStatementError(db(), APPLY, [payload([...list, list[0]!])], /VB422/);
      const body = payload(list);
      body.stage_record.ballot_count = 2;
      await expectStatementError(db(), APPLY, [body], /VB422/);
      expect(await count(db(), "public.batches")).toBe(0);
    });
  });

  test("county membership is every ballot with the status in the county's precincts", async () => {
    await inRolledBackTransaction(db(), "service_role", async () => {
      await seed(5);
      const { rows } = await db().query(MEMBERS, ["county", COUNTY, "CAST"]);
      expect(rows[0].r).toHaveLength(5);
      const other = await db().query(MEMBERS, ["county", "C-ELSEWHERE", "CAST"]);
      expect(other.rows[0].r).toEqual([]);
      const tallied = await db().query(MEMBERS, ["county", COUNTY, "TALLIED_PRECINCT"]);
      expect(tallied.rows[0].r).toEqual([]);
      await expectStatementError(db(), MEMBERS, ["state", "IN", "CAST"], /VB422/);
    });
  });
});

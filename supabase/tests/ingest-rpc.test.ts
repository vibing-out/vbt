import { buildMismatchEvents, indianaDate, MISMATCH_REASON, verifyChain } from "@vbt/events";
import { beforeAll, expect, test } from "vitest";
import {
  chainOf,
  count,
  COUNTY,
  ingestPayload,
  MACHINE,
  newBallot,
  OFFICIAL,
  OTHER_PRECINCT,
  seedPlaces,
} from "./rpc-fixtures.ts";
import { describeDb, expectStatementError, inRolledBackTransaction, useScratchDatabase } from "./support.ts";

const INGEST = "select public.ingest_ballot_record($1::jsonb) as r";
const HEADS = "select public.chain_heads($1::text[]) as r";

describeDb("ingest_ballot_record (T-05 AC5, AC6)", () => {
  const db = useScratchDatabase();
  beforeAll(async () => seedPlaces(db()));

  test("AC5: a valid file creates its ballots, one CAST event each and one ingest_files row", async () => {
    await inRolledBackTransaction(db(), "service_role", async () => {
      const ballots = [newBallot("CODE-A"), newBallot("CODE-B"), newBallot("CODE-C")];
      const payload = ingestPayload(ballots);
      const { rows } = await db().query(INGEST, [payload]);
      const result = rows[0].r as { file_id: string; event_ids: string[] };
      expect(Object.keys(result).sort()).toEqual(["event_ids", "file_id"]);
      expect(result.event_ids).toHaveLength(3);

      const files = await db().query("select sha256, kind, actor_id, ballot_count from private.ingest_files where id = $1", [
        result.file_id,
      ]);
      expect(files.rows).toEqual([{ sha256: payload.sha256, kind: "ballot_record", actor_id: OFFICIAL, ballot_count: 3 }]);

      const events = await db().query(
        `select e.id, e.event_type, e.from_status, e.to_status, e.actor_role, e.actor_id, e.county_id,
                e.occurred_on::text as day, b.current_status, b.mismatch
         from private.ballot_events e join private.ballots b on b.id = e.ballot_id order by b.tracking_code`,
      );
      expect(events.rows.map((r) => r.id).sort()).toEqual([...result.event_ids].sort());
      for (const row of events.rows) {
        expect(row).toMatchObject({
          event_type: "CAST",
          from_status: null,
          to_status: null,
          actor_role: "machine",
          actor_id: MACHINE,
          county_id: COUNTY,
          day: "2026-11-03",
          current_status: "CAST",
          mismatch: false,
        });
      }
      for (const b of ballots) expect(verifyChain(await chainOf(db(), b.tracking_code))).toEqual({ ok: true });
    });
  });

  test("C6: only the cast date is stored: the CAST event is at noon Indiana time", async () => {
    await inRolledBackTransaction(db(), "service_role", async () => {
      await db().query(INGEST, [ingestPayload([newBallot("CODE-NOON")])]);
      const { rows } = await db().query(
        `select (e.occurred_at at time zone 'America/Indiana/Indianapolis')::time::text as t
         from private.ballot_events e join private.ballots b on b.id = e.ballot_id where b.tracking_code = 'CODE-NOON'`,
      );
      expect(rows).toEqual([{ t: "12:00:00" }]);
    });
  });

  test("AC5: the same file (same sha256) twice is refused and writes nothing more", async () => {
    await inRolledBackTransaction(db(), "service_role", async () => {
      const payload = ingestPayload([newBallot("CODE-D")]);
      await db().query(INGEST, [payload]);
      const again = ingestPayload([newBallot("CODE-E")], { sha: payload.sha256 });
      const error = await expectStatementError(db(), INGEST, [again], /VB409/);
      expect(error.message).toMatch(/already uploaded/);
      expect(await count(db(), "private.ingest_files")).toBe(1);
      expect(await count(db(), "private.ballots")).toBe(1);
    });
  });

  test.each([
    ["a precinct outside the file's county", OTHER_PRECINCT],
    ["an unknown precinct", "P-NOWHERE"],
  ])("AC5: %s is refused and nothing is written", async (_name, precinct) => {
    await inRolledBackTransaction(db(), "service_role", async () => {
      const payload = ingestPayload([newBallot("CODE-F"), newBallot("CODE-G", { precinct })]);
      await expectStatementError(db(), INGEST, [payload], /VB422/);
      expect(await count(db(), "private.ingest_files")).toBe(0);
      expect(await count(db(), "private.ballots")).toBe(0);
      expect(await count(db(), "private.ballot_events")).toBe(0);
    });
  });

  test("a tracking code already stored, sent again as new, fails the whole file", async () => {
    await inRolledBackTransaction(db(), "service_role", async () => {
      await db().query(INGEST, [ingestPayload([newBallot("CODE-H")])]);
      await expectStatementError(db(), INGEST, [ingestPayload([newBallot("CODE-I"), newBallot("CODE-H")])], /23505/);
      expect(await count(db(), "private.ballots")).toBe(1);
      expect(await count(db(), "private.ingest_files")).toBe(1);
    });
  });

  test("chain_heads returns each stored code's status, hash and chain head", async () => {
    await inRolledBackTransaction(db(), "service_role", async () => {
      const ballot = newBallot("CODE-J");
      await db().query(INGEST, [ingestPayload([ballot])]);
      const { rows } = await db().query(HEADS, [["CODE-J", "CODE-UNKNOWN"]]);
      expect(rows[0].r).toEqual([
        expect.objectContaining({
          tracking_code: "CODE-J",
          ciphertext_hash: ballot.ciphertext_hash,
          current_status: "CAST",
          county_id: COUNTY,
          head_hash: ballot.hash,
          heads: 1,
        }),
      ]);
    });
  });

  async function mismatchOf(code: string, now = new Date()) {
    const { rows } = await db().query(HEADS, [[code]]);
    const head = rows[0].r[0] as { current_status: "CAST"; head_hash: string };
    const plan = buildMismatchEvents({
      tracking_code: code,
      current_status: head.current_status,
      head_hash: head.head_hash,
      occurred_on: indianaDate(now),
    });
    return {
      tracking_code: code,
      ciphertext_hash: "f".repeat(64),
      expected_status: head.current_status,
      new_status: plan.new_status,
      events: plan.events.map((e) => ({ ...e, occurred_at: now.toISOString(), actor_role: "county", actor_id: OFFICIAL })),
    };
  }

  test("AC6: a code re-sent with a different ciphertext gets MISMATCH_DETECTED then CHALLENGED; ciphertext unchanged", async () => {
    await inRolledBackTransaction(db(), "service_role", async () => {
      const original = newBallot("CODE-K");
      await db().query(INGEST, [ingestPayload([original])]);
      const mismatch = await mismatchOf("CODE-K");
      const { rows } = await db().query(INGEST, [ingestPayload([], { mismatches: [mismatch] })]);
      expect(rows[0].r.event_ids).toHaveLength(2);

      const ballot = await db().query("select ciphertext, ciphertext_hash, current_status, mismatch from private.ballots");
      expect(ballot.rows).toEqual([
        { ciphertext: original.ciphertext, ciphertext_hash: original.ciphertext_hash, current_status: "CHALLENGED", mismatch: true },
      ]);
      const chain = await chainOf(db(), "CODE-K");
      expect(chain.map((e) => [e.event_type, e.from_status, e.to_status, e.reason])).toEqual([
        ["CAST", null, null, null],
        ["MISMATCH_DETECTED", null, null, MISMATCH_REASON],
        ["STATUS_CHANGE", "CAST", "CHALLENGED", MISMATCH_REASON],
      ]);
      expect(verifyChain(chain)).toEqual({ ok: true });
    });
  });

  test("a mismatch whose ballot changed since it was read is refused, nothing written", async () => {
    await inRolledBackTransaction(db(), "service_role", async () => {
      await db().query(INGEST, [ingestPayload([newBallot("CODE-L")])]);
      const mismatch = await mismatchOf("CODE-L");
      await db().query("update private.ballots set current_status = 'TALLIED_PRECINCT' where tracking_code = 'CODE-L'");
      await expectStatementError(db(), INGEST, [ingestPayload([], { mismatches: [mismatch] })], /VB409/);
      // Status matches again, but the events were built for the old status.
      const wrongFrom = { ...(await mismatchOf("CODE-L")), events: mismatch.events };
      await expectStatementError(db(), INGEST, [ingestPayload([], { mismatches: [wrongFrom] })], /VB409/);
      expect(await count(db(), "private.ballot_events")).toBe(1);

      // The chain head moved after the read.
      const fresh = await mismatchOf("CODE-L");
      await db().query(
        `insert into private.ballot_events (ballot_id, precinct_id, county_id, event_type, from_status, to_status,
                                            actor_role, actor_id, occurred_at, prev_hash, hash)
         select b.id, b.precinct_id, $2, 'STATUS_CHANGE', 'CAST', 'TALLIED_PRECINCT', 'county', $3, now(), $1, $4
         from private.ballots b where b.tracking_code = 'CODE-L'`,
        [fresh.events[0]!.prev_hash, COUNTY, OFFICIAL, "e".repeat(64)],
      );
      await expectStatementError(db(), INGEST, [ingestPayload([], { mismatches: [fresh] })], /VB409/);
      expect(await count(db(), "private.ballot_events")).toBe(2);
      expect(await count(db(), "private.ingest_files")).toBe(1);
    });
  });
});

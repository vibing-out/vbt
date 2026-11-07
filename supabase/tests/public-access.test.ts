import { expect, test } from "vitest";
import { asRole, asRoleSteps, describeDb, PERMISSION_DENIED, useScratchDatabase } from "./support.ts";

const PUBLIC_ROLES = ["anon", "authenticated"] as const;

describeDb("the public cannot read ciphertext", () => {
  const db = useScratchDatabase({ seed: true });

  for (const role of PUBLIC_ROLES) {
    test.each([
      "select ciphertext from ballots",
      "select * from ballots",
      "select b.tracking_code from ballots b where b.ciphertext like 'seed%'",
      "select ciphertext from ballot_public",
    ])(`${role}: %s is refused`, async (sql) => {
      await expect(asRole(db(), role, sql)).rejects.toThrow(/permission denied|does not exist/);
    });
  }

  test("ballot_public has no ciphertext column", async () => {
    const { rows } = await db().query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'ballot_public' order by 1`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      "cast_date",
      "ciphertext_hash",
      "current_status",
      "id",
      "precinct_id",
      "tracking_code",
    ]);
  });

  // Sequence and machine linkage would let someone order ballots (locked principle 5: no ordering leaks).
  test.each(["prev_tracking_code", "machine_id", "ballot_style", "mismatch"])(
    "anon cannot read ballots.%s",
    async (column) => {
      await expect(asRole(db(), "anon", `select ${column} from ballots`)).rejects.toThrow(PERMISSION_DENIED);
    },
  );
});

describeDb("the public cannot read event times", () => {
  const db = useScratchDatabase({ seed: true });

  for (const role of PUBLIC_ROLES) {
    test.each([
      "select occurred_at from ballot_events",
      "select recorded_at from ballot_events",
      "select * from ballot_events",
      "select id from ballot_events order by occurred_at",
      "select id from ballot_events where recorded_at > now() - interval '1 day'",
      "select actor_id from ballot_events",
      "select batch_id from ballot_events",
      "select nist_event_code from ballot_events",
      "select created_at from batches",
    ])(`${role}: %s is refused`, async (sql) => {
      await expect(asRole(db(), role, sql)).rejects.toThrow(PERMISSION_DENIED);
    });
  }

  test("ballot_event_public exposes a date and no time-of-day column", async () => {
    const { rows } = await db().query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'ballot_event_public' order by 1`,
    );
    expect(rows.filter((r) => /time|interval/.test(r.data_type))).toEqual([]);
    expect(rows.find((r) => r.column_name === "occurred_on")?.data_type).toBe("date");
    expect(rows.map((r) => r.column_name)).toEqual([
      "ballot_id",
      "county_id",
      "event_type",
      "from_status",
      "hash",
      "id",
      "occurred_on",
      "precinct_id",
      "prev_hash",
      "reason",
      "to_status",
    ]);
  });

  test("anon sees the seeded CAST events dated election day", async () => {
    const { rows } = await asRole(
      db(),
      "anon",
      "select distinct event_type, to_char(occurred_on, 'YYYY-MM-DD') as day from ballot_event_public",
    );
    expect(rows).toEqual([{ event_type: "CAST", day: "2026-11-03" }]);
  });

  test("the date is Indiana local, so a late-evening event keeps its election-day date", async () => {
    const { rows } = await asRoleSteps(db(), "postgres", [
      {
        sql: `insert into ballot_events (ballot_id, precinct_id, county_id, event_type, actor_role, actor_id,
                                         occurred_at, hash)
              select id, precinct_id, '18097', 'MISMATCH_DETECTED', 'county', 'c-1',
                     timestamptz '2026-11-04 03:30:00+00', 'h'
              from ballots where tracking_code = 'SEED-0002'`,
      },
      { sql: "set local role anon" },
      {
        sql: `select to_char(occurred_on, 'YYYY-MM-DD') as day from ballot_event_public
              where event_type = 'MISMATCH_DETECTED'`,
      },
    ]);
    expect(rows).toEqual([{ day: "2026-11-03" }]);
  });
});

describeDb("what the public can read", () => {
  const db = useScratchDatabase({ seed: true });

  for (const role of PUBLIC_ROLES) {
    test(`${role} reads tracking codes, ciphertext hashes, statuses and cast dates`, async () => {
      const { rows } = await asRole(
        db(),
        role,
        `select tracking_code, ciphertext_hash, current_status, to_char(cast_date, 'YYYY-MM-DD') as cast_date
         from ballot_public order by tracking_code`,
      );
      expect(rows).toHaveLength(50);
      expect(rows[0]).toEqual({
        tracking_code: "SEED-0001",
        ciphertext_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        current_status: "CAST",
        cast_date: "2026-11-03",
      });
    });

    test(`${role} reads the same safe columns straight from ballots`, async () => {
      const { rows } = await asRole(
        db(),
        role,
        "select count(*)::int as n from ballots where ciphertext_hash is not null and current_status = 'CAST'",
      );
      expect(rows[0]).toEqual({ n: 50 });
    });

    test(`${role} reads precincts and the safe event view`, async () => {
      const precincts = await asRole(db(), role, "select id from precincts");
      expect(precincts.rowCount).toBe(3);
      const events = await asRole(db(), role, "select ballot_id, event_type, occurred_on from ballot_event_public");
      expect(events.rowCount).toBe(50);
    });

    test(`${role} reads only stage records whose publication time has come`, async () => {
      const { rows } = await asRoleSteps(db(), "service_role", [
        {
          sql: `insert into stage_records (scope, scope_id, stage, merkle_root, ballot_count, totals, published_at, signature)
                values
                  ('precinct', '18097-001', 'TALLIED_PRECINCT', 'published', 17, '{}', now() - interval '1 hour', 'sig'),
                  ('precinct', '18057-001', 'TALLIED_PRECINCT', 'scheduled', 16, '{}', now() + interval '1 day', 'sig')`,
        },
        { sql: `set local role ${role}` },
        { sql: "select merkle_root, scope_id, ballot_count, signature from stage_records" },
      ]);
      expect(rows).toEqual([{ merkle_root: "published", scope_id: "18097-001", ballot_count: 17, signature: "sig" }]);
    });

    test(`${role} cannot read batches`, async () => {
      await expect(asRole(db(), role, "select id from batches")).rejects.toThrow(PERMISSION_DENIED);
    });
  }

  test("service_role reads everything, ciphertext and event times included", async () => {
    const { rows } = await asRole(
      db(),
      "service_role",
      "select count(*)::int as n from ballots b join ballot_events e on e.ballot_id = b.id where b.ciphertext is not null and e.occurred_at is not null",
    );
    expect(rows[0]).toEqual({ n: 50 });
  });
});

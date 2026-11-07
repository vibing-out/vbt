import { BALLOT_STATUSES, type BallotStatus } from "@vbt/domain";
import { expect, test } from "vitest";
import { chainEvent, verifyChain } from "./chain.ts";
import { buildMismatchEvents, MISMATCH_REASON } from "./mismatch.ts";

const CODE = "RIVER-MAPLE-7Q4K-HAWK";
const cast = chainEvent(
  { tracking_code: CODE, event_type: "CAST", from_status: null, to_status: null, reason: null, occurred_on: "2026-11-03" },
  null,
);

test.each(["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL"] as const)(
  "AC6: a %s ballot gets MISMATCH_DETECTED then STATUS_CHANGE -> CHALLENGED, chained to its head",
  (status) => {
    const plan = buildMismatchEvents({ tracking_code: CODE, current_status: status, head_hash: cast.hash, occurred_on: "2026-11-04" });
    expect(plan.new_status).toBe("CHALLENGED");
    expect(plan.events.map((e) => [e.event_type, e.from_status, e.to_status, e.reason])).toEqual([
      ["MISMATCH_DETECTED", null, null, MISMATCH_REASON],
      ["STATUS_CHANGE", status, "CHALLENGED", MISMATCH_REASON],
    ]);
    expect(plan.events[0]!.prev_hash).toBe(cast.hash);
    expect(verifyChain([cast, ...plan.events])).toEqual({ ok: true });
  },
);

test.each(["CHALLENGED", "CERTIFIED", "DISCARDED", "SPOILED"] as const)(
  "a %s ballot gets only MISMATCH_DETECTED and keeps its status",
  (status) => {
    const plan = buildMismatchEvents({ tracking_code: CODE, current_status: status, head_hash: cast.hash, occurred_on: "2026-11-04" });
    expect(plan.new_status).toBeNull();
    expect(plan.events.map((e) => e.event_type)).toEqual(["MISMATCH_DETECTED"]);
    expect(verifyChain([cast, ...plan.events])).toEqual({ ok: true });
  },
);

test("every status is handled", () => {
  for (const status of BALLOT_STATUSES as readonly BallotStatus[]) {
    expect(() => buildMismatchEvents({ tracking_code: CODE, current_status: status, head_hash: null, occurred_on: "2026-11-04" })).not.toThrow();
  }
});

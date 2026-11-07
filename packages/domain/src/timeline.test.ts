import { expect, test } from "vitest";
import { FALLBACK_RANK, orderByChain, type PublicEvent } from "./index.ts";
import { BALLOT_STATUSES } from "./status.ts";

const ev = (hash: string, prev: string | null, to: string | null, type = to ? "STATUS_CHANGE" : "CAST"): PublicEvent => ({
  event_type: type,
  from_status: null,
  to_status: to,
  reason: null,
  occurred_on: "2026-11-03",
  prev_hash: prev,
  hash,
});

const statuses = (events: PublicEvent[]) => events.map((e) => e.to_status ?? e.event_type);

test("follows the hash chain even when the view returns rows in hash order", () => {
  // Hash order: 0a < 5c < 9f < d2, which is not chain order.
  const rows = [ev("0a", "9f", "REPORTED_UNOFFICIAL"), ev("5c", "d2", "TALLIED_PRECINCT"), ev("9f", "5c", "CHALLENGED"), ev("d2", null, null)];
  // Chain: d2 (CAST) → 5c (TALLIED) → 9f (CHALLENGED) → 0a (REPORTED)
  const { events, chained } = orderByChain(rows);
  expect(chained).toBe(true);
  expect(statuses(events)).toEqual(["CAST", "TALLIED_PRECINCT", "CHALLENGED", "REPORTED_UNOFFICIAL"]);
});

test("a challenge and its restoration keep chain order", () => {
  const rows = [
    ev("c3", "b2", "TALLIED_PRECINCT", "CHALLENGE_RESOLVED"),
    ev("a1", null, null),
    ev("b2", "x9", "CHALLENGED"),
    ev("x9", "a1", "TALLIED_PRECINCT"),
  ];
  expect(statuses(orderByChain(rows).events)).toEqual(["CAST", "TALLIED_PRECINCT", "CHALLENGED", "TALLIED_PRECINCT"]);
});

test.each([
  ["a gap", [ev("c3", "zz", "REPORTED_UNOFFICIAL"), ev("a1", null, null), ev("b2", "a1", "TALLIED_PRECINCT")]],
  ["a fork", [ev("c3", "a1", "REPORTED_UNOFFICIAL"), ev("a1", null, null), ev("b2", "a1", "TALLIED_PRECINCT")]],
  ["two roots", [ev("c3", null, "REPORTED_UNOFFICIAL"), ev("a1", null, null), ev("b2", "a1", "TALLIED_PRECINCT")]],
])("falls back to state-machine order on %s", (_name, rows) => {
  const { events, chained } = orderByChain(rows);
  expect(chained).toBe(false);
  expect(statuses(events)).toEqual(["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL"]);
});

test("a cycle falls back instead of looping", () => {
  const rows = [ev("a1", null, null), ev("b2", "a1", "TALLIED_PRECINCT"), ev("a1", "b2", "REPORTED_UNOFFICIAL")];
  expect(orderByChain(rows).chained).toBe(false);
});

test("no events is an empty, valid chain", () => {
  expect(orderByChain([])).toEqual({ events: [], chained: true });
});

test("an event with an unknown status sorts last in the fallback", () => {
  const rows = [ev("c3", "zz", "NOT_A_STATUS"), ev("b2", "a1", "TALLIED_PRECINCT"), ev("a1", null, null)];
  const { events, chained } = orderByChain(rows);
  expect(chained).toBe(false);
  expect(statuses(events)).toEqual(["CAST", "TALLIED_PRECINCT", "NOT_A_STATUS"]);
});

test("the fallback rank covers every status exactly once", () => {
  expect(Object.keys(FALLBACK_RANK).sort()).toEqual([...BALLOT_STATUSES].sort());
  expect(new Set(Object.values(FALLBACK_RANK)).size).toBe(BALLOT_STATUSES.length);
});

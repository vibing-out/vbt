import { describe, expect, test } from "vitest";
import {
  BALLOT_STATUSES,
  BATCH_SCOPES,
  type BallotStatus,
  type BatchScope,
  CHALLENGEABLE_STATUSES,
  findRule,
  isTerminal,
  TRANSITIONS,
  transition,
  type TransitionInput,
  validateBatchTransition,
} from "./index.ts";

// Written out by hand from docs/locked-interfaces.md, independently of
// TRANSITIONS, so a mistake in the table is caught here.
const LOCKED_EDGES: ReadonlyArray<[BallotStatus, BallotStatus, BatchScope | null]> = [
  ["CAST", "TALLIED_PRECINCT", "precinct"],
  ["TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "county"],
  ["REPORTED_UNOFFICIAL", "CERTIFIED", "county"],
  ["CAST", "CHALLENGED", null],
  ["TALLIED_PRECINCT", "CHALLENGED", null],
  ["REPORTED_UNOFFICIAL", "CHALLENGED", null],
  ["CHALLENGED", "CAST", null],
  ["CHALLENGED", "TALLIED_PRECINCT", null],
  ["CHALLENGED", "REPORTED_UNOFFICIAL", null],
  ["CHALLENGED", "DISCARDED", null],
  ["CAST", "SPOILED", null],
];

const isLocked = (from: BallotStatus, to: BallotStatus) =>
  LOCKED_EDGES.some(([f, t]) => f === from && t === to);

const ALL_PAIRS = BALLOT_STATUSES.flatMap((from) =>
  BALLOT_STATUSES.map((to) => [from, to] as [BallotStatus, BallotStatus]),
);
const ALLOWED_PAIRS = ALL_PAIRS.filter(([f, t]) => isLocked(f, t));
const DISALLOWED_PAIRS = ALL_PAIRS.filter(([f, t]) => !isLocked(f, t));

/** The metadata a valid request for this edge carries. */
function validInput(from: BallotStatus, to: BallotStatus): TransitionInput {
  if (to === "DISCARDED") return { from, to, reason: "Duplicate ballot" };
  if (from === "CHALLENGED") return { from, to, heldStatus: to };
  return { from, to };
}

describe("transition table", () => {
  test("TRANSITIONS is exactly the locked edge list", () => {
    const actual = TRANSITIONS.map((r) => [r.from, r.to, r.batch]);
    expect(actual).toHaveLength(LOCKED_EDGES.length);
    expect(actual).toEqual(expect.arrayContaining(LOCKED_EDGES.map((e) => [...e])));
  });

  test("the table is frozen", () => {
    expect(Object.isFrozen(TRANSITIONS)).toBe(true);
    expect(Object.isFrozen(TRANSITIONS[0])).toBe(true);
    expect(Object.isFrozen(CHALLENGEABLE_STATUSES)).toBe(true);
    expect(Object.isFrozen(BATCH_SCOPES)).toBe(true);
    expect(Object.isFrozen(BALLOT_STATUSES)).toBe(true);
  });

  test("findRule finds locked edges and nothing else", () => {
    for (const [from, to] of ALL_PAIRS) {
      expect(findRule(from, to) !== undefined).toBe(isLocked(from, to));
    }
  });

  test("49 pairs split into 11 allowed and 38 disallowed", () => {
    expect(ALL_PAIRS).toHaveLength(49);
    expect(ALLOWED_PAIRS).toHaveLength(11);
    expect(DISALLOWED_PAIRS).toHaveLength(38);
  });
});

describe("AC4 (allowed): every locked edge is accepted", () => {
  test.each(ALLOWED_PAIRS)("%s -> %s", (from, to) => {
    expect(transition(validInput(from, to))).toEqual({ ok: true, status: to });
  });

  test("batch edges are accepted by transition() without batch metadata", () => {
    for (const [from, to, batch] of LOCKED_EDGES) {
      if (batch !== null) expect(transition({ from, to })).toEqual({ ok: true, status: to });
    }
  });
});

describe("AC2: transition() rejects every move not in the transition table", () => {
  test.each(DISALLOWED_PAIRS)("%s -> %s is rejected", (from, to) => {
    // Even with every optional field filled in, a move off the table fails.
    const result = transition({ from, to, reason: "any", heldStatus: to });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_TRANSITION");
      expect(result.message).toContain(`${from} -> ${to}`);
    }
  });

  test.each(BALLOT_STATUSES)("same-status move %s -> %s is rejected", (s) => {
    expect(transition({ from: s, to: s })).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });

  test.each(BALLOT_STATUSES.filter(isTerminal))("terminal %s has no outgoing moves", (from) => {
    for (const to of BALLOT_STATUSES) {
      const result = transition({ from, to, reason: "x", heldStatus: "CAST" });
      expect(result).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
      if (!result.ok) expect(result.message).toContain("terminal");
    }
  });

  test("unknown statuses are rejected without throwing", () => {
    const bogus = "PENDING" as BallotStatus;
    expect(transition({ from: bogus, to: "CAST" })).toMatchObject({
      ok: false,
      code: "INVALID_STATUS",
      message: expect.stringContaining("PENDING"),
    });
    expect(transition({ from: "CAST", to: bogus })).toMatchObject({
      ok: false,
      code: "INVALID_STATUS",
      message: expect.stringContaining("PENDING"),
    });
  });
});

describe("CHALLENGED -> DISCARDED requires a reason", () => {
  test.each([undefined, "", "   ", "\n\t"])("reason %j is rejected", (reason) => {
    const input: TransitionInput = { from: "CHALLENGED", to: "DISCARDED" };
    if (reason !== undefined) input.reason = reason;
    expect(transition(input)).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
  });

  test("non-string reason from untyped callers is rejected", () => {
    const input = { from: "CHALLENGED", to: "DISCARDED", reason: 42 } as unknown as TransitionInput;
    expect(transition(input)).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
  });

  test("a non-empty reason is accepted and no held status is needed", () => {
    expect(transition({ from: "CHALLENGED", to: "DISCARDED", reason: " Voter signed twice " })).toEqual({
      ok: true,
      status: "DISCARDED",
    });
  });
});

describe("CHALLENGED -> status held before the challenge", () => {
  test.each(CHALLENGEABLE_STATUSES)("missing heldStatus is rejected (to %s)", (to) => {
    expect(transition({ from: "CHALLENGED", to })).toMatchObject({ ok: false, code: "HELD_STATUS_REQUIRED" });
  });

  test.each(["CERTIFIED", "CHALLENGED", "DISCARDED", "SPOILED"] as const)(
    "heldStatus %s cannot be held before a challenge",
    (heldStatus) => {
      expect(transition({ from: "CHALLENGED", to: "CAST", heldStatus })).toMatchObject({
        ok: false,
        code: "INVALID_HELD_STATUS",
      });
    },
  );

  test("an unknown heldStatus is rejected", () => {
    const heldStatus = "PENDING" as BallotStatus;
    expect(transition({ from: "CHALLENGED", to: "CAST", heldStatus })).toMatchObject({
      ok: false,
      code: "INVALID_HELD_STATUS",
    });
  });

  test.each(
    CHALLENGEABLE_STATUSES.flatMap((held) =>
      CHALLENGEABLE_STATUSES.filter((to) => to !== held).map((to) => [held, to] as const),
    ),
  )("held %s but resolving to %s is a mismatch", (heldStatus, to) => {
    expect(transition({ from: "CHALLENGED", to, heldStatus })).toMatchObject({
      ok: false,
      code: "HELD_STATUS_MISMATCH",
    });
  });

  test("heldStatus is not required, and is ignored, on other paths", () => {
    expect(transition({ from: "CAST", to: "CHALLENGED" })).toEqual({ ok: true, status: "CHALLENGED" });
    expect(transition({ from: "CAST", to: "CHALLENGED", heldStatus: "CERTIFIED" })).toEqual({
      ok: true,
      status: "CHALLENGED",
    });
  });
});

describe("AC3: batch-transition validation", () => {
  test.each([
    ["CAST", "TALLIED_PRECINCT", "precinct"],
    ["TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "county"],
    ["REPORTED_UNOFFICIAL", "CERTIFIED", "county"],
  ] as const)("%s -> %s per %s is accepted", (from, to, scope) => {
    expect(validateBatchTransition({ from, to, scope })).toEqual({ ok: true, status: to });
  });

  test.each([
    ["CAST", "TALLIED_PRECINCT", "county"],
    ["TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "precinct"],
    ["REPORTED_UNOFFICIAL", "CERTIFIED", "precinct"],
  ] as const)("%s -> %s per %s is the wrong scope", (from, to, scope) => {
    expect(validateBatchTransition({ from, to, scope })).toMatchObject({ ok: false, code: "INVALID_BATCH_SCOPE" });
  });

  test("an unknown scope is rejected", () => {
    const scope = "state" as BatchScope;
    expect(validateBatchTransition({ from: "REPORTED_UNOFFICIAL", to: "CERTIFIED", scope })).toMatchObject({
      ok: false,
      code: "INVALID_BATCH_SCOPE",
      message: expect.stringContaining("state"),
    });
  });

  test("every pair that is not a batch edge is rejected for both scopes", () => {
    const batchEdges = LOCKED_EDGES.filter(([, , b]) => b !== null);
    for (const [from, to] of ALL_PAIRS) {
      if (batchEdges.some(([f, t]) => f === from && t === to)) continue;
      for (const scope of ["precinct", "county"] as const) {
        expect(validateBatchTransition({ from, to, scope })).toMatchObject({
          ok: false,
          code: "NOT_BATCH_TRANSITION",
        });
      }
    }
  });
});

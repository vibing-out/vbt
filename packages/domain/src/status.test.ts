import { describe, expect, test } from "vitest";
import * as domain from "./index.ts";
import {
  BALLOT_STATUSES,
  type BallotStatus,
  isBallotStatus,
  isTerminal,
  publicLabel,
} from "./index.ts";

// Copied from docs/locked-interfaces.md § Ballot status state machine.
const LOCKED: ReadonlyArray<[BallotStatus, string, boolean]> = [
  ["CAST", "Cast and sealed", false],
  ["TALLIED_PRECINCT", "Counted at precinct", false],
  ["REPORTED_UNOFFICIAL", "Included in election-night results", false],
  ["CERTIFIED", "Included in certified results", true],
  ["CHALLENGED", "Under review", false],
  ["DISCARDED", "Not counted (reason shown)", true],
  ["SPOILED", "Spoiled by voter to check the machine; not counted", true],
];

describe("AC1: exports status and transition types matching Locked interfaces", () => {
  test("runtime status set equals the locked set, in locked order", () => {
    expect([...BALLOT_STATUSES]).toEqual(LOCKED.map(([s]) => s));
  });

  test("package entry exports the public API", () => {
    for (const name of [
      "BALLOT_STATUSES",
      "isBallotStatus",
      "publicLabel",
      "isTerminal",
      "transition",
      "validateBatchTransition",
      "TRANSITIONS",
      "BATCH_SCOPES",
      "CHALLENGEABLE_STATUSES",
      "findRule",
    ]) {
      expect(domain).toHaveProperty(name);
    }
  });

  test("isBallotStatus accepts locked statuses and rejects anything else", () => {
    for (const s of BALLOT_STATUSES) expect(isBallotStatus(s)).toBe(true);
    for (const v of ["cast", "PENDING", "", 1, null, undefined, {}]) {
      expect(isBallotStatus(v)).toBe(false);
    }
  });
});

describe("AC3: voter-facing labels", () => {
  test.each(LOCKED)("publicLabel(%s) is the locked string", (status, label) => {
    expect(publicLabel(status)).toBe(label);
  });
});

describe("isTerminal", () => {
  test.each(LOCKED)("isTerminal(%s) matches the lock", (status, _label, terminal) => {
    expect(isTerminal(status)).toBe(terminal);
  });
});

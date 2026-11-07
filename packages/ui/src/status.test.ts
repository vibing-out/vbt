// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { ADMIN_LABELS, BALLOT_STATUSES, OFF_PATH_STATUSES, STAGES, STATUS_ICONS, VOTER_LABELS } from "./status";

// The locked "Ballot status state machine" table in docs/locked-interfaces.md.
const locked = readFileSync(new URL("../../../docs/locked-interfaces.md", import.meta.url), "utf8");
const section = locked.slice(locked.indexOf("## Ballot status state machine"), locked.indexOf("| From | To |"));
const rows = [...section.matchAll(/^\| `([A-Z_]+)` \| ([^|]+) \|/gm)].map((m) => [m[1], m[2]?.trim()] as const);

describe("status presentation matches the locked state machine", () => {
  test("the seven codes, in order", () => {
    expect(rows.map(([code]) => code)).toEqual([...BALLOT_STATUSES]);
  });

  test("voter labels are the locked public labels", () => {
    for (const [code, label] of rows) {
      const expected = label?.replace(" (reason shown)", "");
      expect(VOTER_LABELS[code as keyof typeof VOTER_LABELS]).toBe(expected);
    }
  });

  test("stages and off-path statuses partition the set", () => {
    expect([...STAGES, ...OFF_PATH_STATUSES].sort()).toEqual([...BALLOT_STATUSES].sort());
  });

  test("admin labels are compact and icons follow the fixed meanings", () => {
    expect(ADMIN_LABELS).toEqual({
      CAST: "Cast",
      TALLIED_PRECINCT: "Counted",
      REPORTED_UNOFFICIAL: "Election night",
      CERTIFIED: "Certified",
      CHALLENGED: "Challenged",
      DISCARDED: "Discarded",
      SPOILED: "Spoiled",
    });
    expect(STATUS_ICONS).toEqual({
      CAST: "lock",
      TALLIED_PRECINCT: "check",
      REPORTED_UNOFFICIAL: "chart",
      CERTIFIED: "badge-check",
      CHALLENGED: "flag",
      DISCARDED: "x-circle",
      SPOILED: "rotate-ccw",
    });
  });
});

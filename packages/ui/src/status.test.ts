// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { BADGE_LABELS, BALLOT_STATUSES, OFF_PATH_STATUSES, STAGE_LABELS, STAGES, STATUS_ICONS, VOTER_LABELS } from "./status";

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

  test("voter badge labels are the locked public labels", () => {
    expect(BADGE_LABELS.voter).toEqual(VOTER_LABELS);
  });

  test("admin badge labels are the StatusBadge README's, word for word", () => {
    expect(BADGE_LABELS.admin).toEqual({
      CAST: "Cast",
      TALLIED_PRECINCT: "Counted at precinct",
      REPORTED_UNOFFICIAL: "Election-night results",
      CERTIFIED: "Certified",
      CHALLENGED: "Under review",
      DISCARDED: "Not counted",
      SPOILED: "Spoiled",
    });
  });

  test("voter timeline stage labels are the locked public labels", () => {
    for (const stage of STAGES) expect(STAGE_LABELS.voter[stage]).toBe(VOTER_LABELS[stage]);
  });

  test("admin timeline stage labels are the StageTimeline README's", () => {
    expect(STAGE_LABELS.admin).toEqual({
      CAST: "Cast and sealed",
      TALLIED_PRECINCT: "Counted at precinct",
      REPORTED_UNOFFICIAL: "Election-night results",
      CERTIFIED: "Certified",
    });
  });

  test("status icons follow the fixed meanings (design system README, Icons)", () => {
    expect(STATUS_ICONS).toEqual({ CERTIFIED: "check", CHALLENGED: "flag", DISCARDED: "x", SPOILED: "undo-2" });
  });
});

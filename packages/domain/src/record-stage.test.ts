import { describe, expect, it } from "vitest";
import { BALLOT_STATUSES } from "./status.ts";
import { isRecordStage, STAGE_SCOPE } from "./record-stage.ts";
import { TRANSITIONS } from "./transition.ts";

describe("STAGE_SCOPE", () => {
  it("maps each published stage to its scope, in the order a ballot moves through them", () => {
    expect(STAGE_SCOPE).toEqual({
      TALLIED_PRECINCT: "precinct",
      REPORTED_UNOFFICIAL: "county",
      CERTIFIED: "county",
      CHALLENGED: "county",
      DISCARDED: "county",
    });
    expect(Object.keys(STAGE_SCOPE)).toEqual(["TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED", "CHALLENGED", "DISCARDED"]);
    expect(Object.isFrozen(STAGE_SCOPE)).toBe(true);
  });

  it("agrees with the batch edges' scopes in the transition table", () => {
    for (const rule of TRANSITIONS.filter((r) => r.batch !== null)) {
      expect(STAGE_SCOPE[rule.to as keyof typeof STAGE_SCOPE]).toBe(rule.batch);
    }
  });

  it("only names real ballot statuses", () => {
    for (const stage of Object.keys(STAGE_SCOPE)) expect(BALLOT_STATUSES).toContain(stage);
  });
});

describe("isRecordStage", () => {
  it("accepts every published stage", () => {
    for (const stage of Object.keys(STAGE_SCOPE)) expect(isRecordStage(stage)).toBe(true);
  });

  it("rejects statuses with no record, inherited keys and non-strings", () => {
    for (const value of ["CAST", "SPOILED", "tallied_precinct", "", "toString", "__proto__", 1, null, undefined, {}]) {
      expect(isRecordStage(value)).toBe(false);
    }
  });
});

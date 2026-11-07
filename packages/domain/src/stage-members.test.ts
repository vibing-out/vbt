import { expect, test } from "vitest";
import { stageMemberEventTypes } from "./index.ts";

test("batch stages count only STATUS_CHANGE into the stage", () => {
  for (const stage of ["TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED"]) {
    expect(stageMemberEventTypes(stage), stage).toEqual(["STATUS_CHANGE"]);
  }
});

test("CHALLENGED counts MISMATCH_DETECTED (official batch) and STATUS_CHANGE (ingest)", () => {
  expect([...stageMemberEventTypes("CHALLENGED")].sort()).toEqual(["MISMATCH_DETECTED", "STATUS_CHANGE"]);
});

test("DISCARDED keeps the STATUS_CHANGE rule", () => {
  expect(stageMemberEventTypes("DISCARDED")).toEqual(["STATUS_CHANGE"]);
});

test("a stage with no record, or an unknown or prototype key, has no members", () => {
  for (const stage of ["CAST", "SPOILED", "challenged", "__proto__", "toString", ""]) {
    expect(stageMemberEventTypes(stage), stage).toEqual([]);
  }
});

test("the lists are frozen", () => {
  expect(Object.isFrozen(stageMemberEventTypes("CHALLENGED"))).toBe(true);
  expect(Object.isFrozen(stageMemberEventTypes("CERTIFIED"))).toBe(true);
});

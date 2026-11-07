import { expect, test } from "vitest";
import { labelBallots } from "./labels.ts";
import { demoCountyId, demoMachineId, demoPrecinctId, demoPrecinctName, isSetId, newSetId } from "./set-id.ts";

test("newSetId makes demo-<6 base32 chars> from the random source", () => {
  expect(newSetId(() => new Uint8Array([0, 1, 25, 26, 31, 32]))).toBe("demo-abz27a");
  for (let i = 0; i < 50; i++) expect(isSetId(newSetId())).toBe(true);
});

test.each(["demo-abc", "demo-ABCDEF", "demo-abcde1", "demo-abcdefg", "x-abcdef", "", 7, null, "demo-abcdef/../x", "demo-abcdef-c"])(
  "isSetId refuses %j",
  (value) => expect(isSetId(value)).toBe(false),
);

test("the precinct, county and machine ids come from the set id alone, within requireRole's 64 characters", () => {
  const id = "demo-k2mzqa";
  expect([demoPrecinctId(id), demoCountyId(id), demoMachineId(id)]).toEqual(["demo-k2mzqa-p", "demo-k2mzqa-c", "demo-k2mzqa-m1"]);
  expect(demoCountyId(id)).toBe(demoCountyId(id));
  expect(demoCountyId(id).length).toBeLessThanOrEqual(64);
  expect(demoPrecinctName(id)).toBe("Judges' demo demo-k2mzqa (precinct)");
  expect(() => demoCountyId("18097")).toThrow(/not a demo set id/);
});

test("labelBallots sorts codes, so shuffled input gives the same labels", () => {
  const codes = ["QX-12", "AB-99", "MM-01", "ZZ-00", "CD-45"];
  const expected = { A: "AB-99", B: "CD-45", C: "MM-01", D: "QX-12", E: "ZZ-00" };
  expect(labelBallots(codes)).toEqual(expected);
  expect(labelBallots([...codes].reverse())).toEqual(expected);
  expect(labelBallots([codes[2]!, codes[4]!, codes[0]!, codes[3]!, codes[1]!])).toEqual(expected);
});

test("labelBallots needs exactly 5 distinct codes", () => {
  expect(() => labelBallots(["a", "b", "c", "d"])).toThrow(/exactly 5/);
  expect(() => labelBallots(["a", "b", "c", "d", "d"])).toThrow(/exactly 5/);
});

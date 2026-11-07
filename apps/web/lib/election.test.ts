import { expect, test } from "vitest";
import { CONTESTS, ELECTION_ID as SIMULATOR_ELECTION_ID } from "../../../tools/simulator/src/fixture.ts";
import { ELECTION_ID, ELECTION_MANIFEST, loadElectionKeys } from "./election";
import { KEY_ENV, KEYS } from "./testing/election-fixtures";

test("C22: the manifest and election id match the simulator fixture", () => {
  expect(ELECTION_ID).toBe(SIMULATOR_ELECTION_ID);
  expect(ELECTION_MANIFEST).toEqual({ contests: CONTESTS.map((c) => ({ id: c.id, choices: c.selections.map((s) => ({ id: s.id })) })) });
});

test("C22: keys decode from standard or URL-safe base64", () => {
  expect(loadElectionKeys(KEY_ENV)).toEqual(KEYS);
  const urlSafe = Object.fromEntries(
    Object.entries(KEY_ENV).map(([k, v]) => [k, Buffer.from(v, "base64").toString("base64url")]),
  );
  expect(loadElectionKeys(urlSafe)).toEqual(KEYS);
});

test.each([
  ["ELECTION_PUBLIC_KEY", undefined],
  ["ELECTION_SECRET_KEY", ""],
  ["ELECTION_SECRET_KEY", Buffer.alloc(31).toString("base64")],
  ["STAGE_SIGNING_SECRET_KEY", KEY_ENV.ELECTION_SECRET_KEY],
])("C22: %s = %j is refused", (name, value) => {
  expect(loadElectionKeys({ ...KEY_ENV, [name]: value })).toBeNull();
});

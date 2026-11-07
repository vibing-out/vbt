import { describe, expect, test } from "vitest";
import * as domain from "./index.ts";
import {
  isOfficialRole,
  OFFICIAL_ROLES,
  type OfficialGrant,
  type OfficialTarget,
  officialMayActOn,
  toOfficialGrant,
} from "./index.ts";

const POLL_WORKER: OfficialGrant = { role: "poll_worker", scope: "precinct", scopeId: "18097-001" };
const COUNTY: OfficialGrant = { role: "county", scope: "county", scopeId: "18097" };
const STATE: OfficialGrant = { role: "state", scope: null, scopeId: null };

// Targets with the county each belongs to (supabase/seed.sql precincts), null when unknown.
const OWN_PRECINCT: [OfficialTarget, string | null] = [{ scope: "precinct", id: "18097-001" }, "18097"];
const SAME_COUNTY_PRECINCT: [OfficialTarget, string | null] = [{ scope: "precinct", id: "18097-002" }, "18097"];
const OTHER_COUNTY_PRECINCT: [OfficialTarget, string | null] = [{ scope: "precinct", id: "18057-001" }, "18057"];
const OWN_COUNTY: [OfficialTarget, string | null] = [{ scope: "county", id: "18097" }, "18097"];
const OTHER_COUNTY: [OfficialTarget, string | null] = [{ scope: "county", id: "18057" }, "18057"];
const UNKNOWN_PRECINCT: [OfficialTarget, string | null] = [{ scope: "precinct", id: "99999-001" }, null];
const UNKNOWN_COUNTY: [OfficialTarget, string | null] = [{ scope: "county", id: "99999" }, null];

const TARGETS = {
  OWN_PRECINCT,
  SAME_COUNTY_PRECINCT,
  OTHER_COUNTY_PRECINCT,
  OWN_COUNTY,
  OTHER_COUNTY,
  UNKNOWN_PRECINCT,
  UNKNOWN_COUNTY,
} as const;

// Every role against every target. Own/other are relative to the poll worker's precinct and county.
const MATRIX: Record<OfficialGrant["role"], Record<keyof typeof TARGETS, boolean>> = {
  poll_worker: {
    OWN_PRECINCT: true,
    SAME_COUNTY_PRECINCT: false,
    OTHER_COUNTY_PRECINCT: false,
    OWN_COUNTY: false,
    OTHER_COUNTY: false,
    UNKNOWN_PRECINCT: false,
    UNKNOWN_COUNTY: false,
  },
  county: {
    OWN_PRECINCT: true,
    SAME_COUNTY_PRECINCT: true,
    OTHER_COUNTY_PRECINCT: false,
    OWN_COUNTY: true,
    OTHER_COUNTY: false,
    UNKNOWN_PRECINCT: false,
    UNKNOWN_COUNTY: false,
  },
  state: {
    OWN_PRECINCT: true,
    SAME_COUNTY_PRECINCT: true,
    OTHER_COUNTY_PRECINCT: true,
    OWN_COUNTY: true,
    OTHER_COUNTY: true,
    UNKNOWN_PRECINCT: false,
    UNKNOWN_COUNTY: false,
  },
};

const GRANTS = { poll_worker: POLL_WORKER, county: COUNTY, state: STATE } as const;

describe("OFFICIAL_ROLES", () => {
  test("are the human actor_role values from the locked event schema, frozen", () => {
    expect([...OFFICIAL_ROLES]).toEqual(["poll_worker", "county", "state"]);
    expect(Object.isFrozen(OFFICIAL_ROLES)).toBe(true);
  });

  test("the package entry exports the official API", () => {
    for (const name of ["OFFICIAL_ROLES", "isOfficialRole", "officialMayActOn", "toOfficialGrant"]) {
      expect(domain).toHaveProperty(name);
    }
  });

  test("isOfficialRole accepts only the three roles", () => {
    for (const role of OFFICIAL_ROLES) expect(isOfficialRole(role)).toBe(true);
    for (const value of ["machine", "simulator", "voter", "STATE", "", null, undefined, 1, {}]) {
      expect(isOfficialRole(value)).toBe(false);
    }
  });
});

describe("toOfficialGrant", () => {
  test.each([
    [{ role: "poll_worker", scope: "precinct", scope_id: "18097-001" }, POLL_WORKER],
    [{ role: "county", scope: "county", scope_id: "18097" }, COUNTY],
    [{ role: "state", scope: null, scope_id: null }, STATE],
  ])("accepts %j", (row, grant) => {
    expect(toOfficialGrant(row)).toEqual(grant);
  });

  test.each([
    null,
    undefined,
    "state",
    [],
    {},
    { role: "poll_worker", scope: "county", scope_id: "18097" },
    { role: "poll_worker", scope: "precinct", scope_id: null },
    { role: "poll_worker", scope: "precinct", scope_id: "  " },
    { role: "county", scope: "precinct", scope_id: "18097-001" },
    { role: "county", scope: "county", scope_id: "" },
    { role: "county", scope: "county", scope_id: 18097 },
    { role: "state", scope: "county", scope_id: "18097" },
    { role: "state", scope: null, scope_id: "18097" },
    { role: "state" },
    { role: "machine", scope: null, scope_id: null },
    { role: "simulator", scope: "precinct", scope_id: "18097-001" },
  ])("rejects %j", (row) => {
    expect(toOfficialGrant(row)).toBeNull();
  });
});

describe("officialMayActOn: every role against every target", () => {
  for (const [role, row] of Object.entries(MATRIX) as Array<[keyof typeof MATRIX, (typeof MATRIX)[keyof typeof MATRIX]]>) {
    for (const [name, allowed] of Object.entries(row) as Array<[keyof typeof TARGETS, boolean]>) {
      test(`${role} ${allowed ? "may" : "may not"} act on ${name}`, () => {
        const [target, countyId] = TARGETS[name];
        expect(officialMayActOn(GRANTS[role], target, countyId)).toBe(allowed);
      });
    }
  }

  test("a poll worker named for a precinct still needs that precinct to exist", () => {
    const ghost: OfficialGrant = { role: "poll_worker", scope: "precinct", scopeId: "99999-001" };
    expect(officialMayActOn(ghost, { scope: "precinct", id: "99999-001" }, null)).toBe(false);
  });

  test("a county official is denied a county target whose id is not its own, whatever county is passed", () => {
    expect(officialMayActOn(COUNTY, { scope: "county", id: "18057" }, "18097")).toBe(false);
  });
});

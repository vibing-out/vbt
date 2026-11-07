// Fixed election fixture: a Marion County–style general election.

import type { DeviceType } from "./types.ts";

export const EPOCH = "2026-11-03T06:00:00.000Z";
export const DEVICE_VERSION = "vbt-sim-1.0.0";
export const DEVICE_TYPE: DeviceType = "scan-single";

export const COUNTY_ID = "marion";
export const COUNTY_NAME = "Marion County";
export const ELECTION_ID = "marion-general-2026-11-03";
export const ELECTION_NAME = "Marion County General Election, November 3, 2026";
export const BALLOT_STYLE_ID = "style-general";

export interface FixtureSelection {
  id: string;
  name: string;
}

export interface FixtureContest {
  id: string;
  kind: "candidate" | "measure";
  name: string;
  votesAllowed: number;
  selections: FixtureSelection[];
}

export const CONTESTS: readonly FixtureContest[] = [
  {
    id: "contest-president",
    kind: "candidate",
    name: "President of the United States",
    votesAllowed: 1,
    selections: [
      { id: "cand-a", name: "Candidate A" },
      { id: "cand-b", name: "Candidate B" },
      { id: "cand-c", name: "Candidate C" },
    ],
  },
  {
    id: "contest-measure-1",
    kind: "measure",
    name: "Public Question 1",
    votesAllowed: 1,
    selections: [
      { id: "yes", name: "Yes" },
      { id: "no", name: "No" },
    ],
  },
];

export function precinctIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `pct-${pad(i + 1)}`);
}

export function machineIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `mach-${pad(i + 1)}`);
}

export function precinctName(id: string): string {
  return `Precinct ${id.slice("pct-".length)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** EPOCH plus a whole number of seconds, as ISO-8601. */
export function timeAt(offsetSeconds: number): string {
  return new Date(Date.parse(EPOCH) + offsetSeconds * 1000).toISOString();
}

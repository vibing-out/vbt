import type { Totals } from "@vbt/domain";
import { IngestError } from "./errors";

// Results totals, in the shape epic/4's simulator writes (tools/simulator/src/types.ts TotalsFile):
// { scope, scopeId, electionId, ballotCount, contests: [{ contestId, selections: [{ selectionId, votes }] }] }.
// scope is "precinct" (precinct results reported to the county), "county-unofficial" (election-night
// results) or "county-certified" (certified results). Aggregates only, never per ballot.

export const TOTALS_SCOPES = Object.freeze(["precinct", "county-unofficial", "county-certified"] as const);
export type TotalsScope = (typeof TOTALS_SCOPES)[number];

export interface TotalsFile {
  readonly scope: TotalsScope;
  readonly scopeId: string;
  readonly electionId: string;
  readonly totals: Totals;
  /** Every contest and selection the file lists, for aggregate decryption. */
  readonly manifest: { contests: Array<{ id: string; choices: Array<{ id: string }> }> };
}

const MAX_ID = 64;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === "string" && value.trim() !== "" && value.length <= MAX_ID;
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function parseTotalsFile(json: unknown): TotalsFile {
  if (!isObject(json)) throw new IngestError("not a totals file");
  const { scope, scopeId, electionId, ballotCount, contests } = json;
  if (typeof scope !== "string" || !(TOTALS_SCOPES as readonly string[]).includes(scope)) {
    throw new IngestError("totals scope must be precinct, county-unofficial or county-certified");
  }
  if (!isId(scopeId)) throw new IngestError("totals file has no valid scopeId");
  if (!isId(electionId)) throw new IngestError("totals file has no valid electionId");
  if (!isCount(ballotCount)) throw new IngestError("ballotCount must be a non-negative integer");
  if (!Array.isArray(contests)) throw new IngestError("contests must be a list");

  const byContest = Object.create(null) as Record<string, Record<string, number>>;
  const manifest: TotalsFile["manifest"] = { contests: [] };
  for (const contest of contests) {
    if (!isObject(contest) || !isId(contest.contestId) || !Array.isArray(contest.selections)) {
      throw new IngestError("each contest needs a contestId and a selections list");
    }
    const contestId = contest.contestId;
    if (Object.hasOwn(byContest, contestId)) throw new IngestError(`contest ${contestId} appears twice`);
    const row = Object.create(null) as Record<string, number>;
    const choices: Array<{ id: string }> = [];
    for (const selection of contest.selections) {
      if (!isObject(selection) || !isId(selection.selectionId) || !isCount(selection.votes)) {
        throw new IngestError(`contest ${contestId}: each selection needs a selectionId and non-negative votes`);
      }
      if (Object.hasOwn(row, selection.selectionId)) {
        throw new IngestError(`contest ${contestId}: selection ${selection.selectionId} appears twice`);
      }
      row[selection.selectionId] = selection.votes;
      choices.push({ id: selection.selectionId });
    }
    byContest[contestId] = row;
    manifest.contests.push({ id: contestId, choices });
  }
  return { scope: scope as TotalsScope, scopeId, electionId, totals: { ballotCount, contests: byContest }, manifest };
}

// Simulator-private totals files (precinct, county unofficial, county certified).

import { CONTESTS, ELECTION_ID } from "../fixture.ts";
import type { CvrFile, TotalsFile } from "../types.ts";

export function emptyTotals(scope: TotalsFile["scope"], scopeId: string): TotalsFile {
  return {
    scope,
    scopeId,
    electionId: ELECTION_ID,
    ballotCount: 0,
    contests: CONTESTS.map((c) => ({
      contestId: c.id,
      selections: c.selections.map((s) => ({ selectionId: s.id, votes: 0 })),
    })),
  };
}

/** Tally allocable, indicated selections from CVR reports. */
export function tallyCvrs(scope: TotalsFile["scope"], scopeId: string, cvrs: readonly CvrFile[]): TotalsFile {
  const totals = emptyTotals(scope, scopeId);
  for (const file of cvrs) {
    for (const ballot of file.CVR) {
      totals.ballotCount++;
      const snap = ballot.CVRSnapshot.find((s) => s["@id"] === ballot.CurrentSnapshotId);
      for (const contest of snap?.CVRContest ?? []) {
        for (const sel of contest.CVRContestSelection) {
          const votes = sel.SelectionPosition.filter((p) => p.HasIndication === "yes" && p.IsAllocable === "yes")
            .reduce((n, p) => n + p.NumberVotes, 0);
          addVotes(totals, contest.ContestId, sel.ContestSelectionId, votes);
        }
      }
    }
  }
  return totals;
}

/** Sum several totals files into one with a new scope. */
export function sumTotals(scope: TotalsFile["scope"], scopeId: string, parts: readonly TotalsFile[]): TotalsFile {
  const totals = emptyTotals(scope, scopeId);
  for (const part of parts) {
    totals.ballotCount += part.ballotCount;
    for (const c of part.contests) {
      for (const s of c.selections) addVotes(totals, c.contestId, s.selectionId, s.votes);
    }
  }
  return totals;
}

export function cloneTotals(t: TotalsFile, scope: TotalsFile["scope"], scopeId: string): TotalsFile {
  return { ...structuredClone(t), scope, scopeId };
}

export function addVotes(totals: TotalsFile, contestId: string, selectionId: string, delta: number): void {
  const contest = totals.contests.find((c) => c.contestId === contestId);
  const sel = contest?.selections.find((s) => s.selectionId === selectionId);
  if (!sel) throw new Error(`unknown selection ${contestId}/${selectionId}`);
  sel.votes += delta;
}

/** True when both files report the same ballot count and votes. Scope fields are ignored. */
export function sameCounts(a: TotalsFile, b: TotalsFile): boolean {
  return JSON.stringify([a.ballotCount, a.contests]) === JSON.stringify([b.ballotCount, b.contests]);
}

export const totalsPath = {
  precinct: (precinctId: string): string => `totals/precinct-${precinctId}.json`,
  county: (countyId: string): string => `totals/county-${countyId}.json`,
  certified: (countyId: string): string => `totals/certified-${countyId}.json`,
} as const;

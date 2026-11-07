/** JSON manifest of contests and choices, published in the election record. */
export type ElectionManifest = {
  contests: ReadonlyArray<{ id: string; choices: ReadonlyArray<{ id: string }> }>;
};

/** One voter's selections. Only ever exists in plaintext before encryption. */
export type BallotPlaintext = {
  contests: ReadonlyArray<{ contestId: string; choiceIds: ReadonlyArray<string> }>;
};

/** contestId → choiceId → count. Aggregate only; never per ballot. */
export type ContestTotals = Record<string, Record<string, number>>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Throws if the manifest is malformed or has duplicate contest or choice ids. */
export function assertValidManifest(manifest: ElectionManifest): void {
  if (!manifest || !Array.isArray(manifest.contests)) {
    throw new TypeError("manifest.contests must be an array");
  }
  const contestIds = new Set<string>();
  for (const contest of manifest.contests) {
    if (!contest || !isNonEmptyString(contest.id)) throw new TypeError("contest id must be a non-empty string");
    if (contestIds.has(contest.id)) throw new Error(`duplicate contest id: ${contest.id}`);
    contestIds.add(contest.id);
    if (!Array.isArray(contest.choices)) throw new TypeError(`contest ${contest.id}: choices must be an array`);
    const choiceIds = new Set<string>();
    for (const choice of contest.choices) {
      if (!choice || !isNonEmptyString(choice.id)) {
        throw new TypeError(`contest ${contest.id}: choice id must be a non-empty string`);
      }
      if (choiceIds.has(choice.id)) throw new Error(`contest ${contest.id}: duplicate choice id: ${choice.id}`);
      choiceIds.add(choice.id);
    }
  }
}

/** Throws if the plaintext is not shaped like a BallotPlaintext. */
export function assertBallotShape(ballot: unknown): asserts ballot is BallotPlaintext {
  const contests = (ballot as { contests?: unknown } | null)?.contests;
  if (!Array.isArray(contests)) throw new TypeError("ballot.contests must be an array");
  const seenContests = new Set<string>();
  for (const entry of contests as unknown[]) {
    const { contestId, choiceIds } = (entry ?? {}) as { contestId?: unknown; choiceIds?: unknown };
    if (!isNonEmptyString(contestId)) throw new TypeError("ballot contestId must be a non-empty string");
    if (seenContests.has(contestId)) throw new Error("ballot lists a contest more than once");
    seenContests.add(contestId);
    if (!Array.isArray(choiceIds) || !choiceIds.every(isNonEmptyString)) {
      throw new TypeError("ballot choiceIds must be an array of non-empty strings");
    }
    if (new Set(choiceIds).size !== choiceIds.length) throw new Error("ballot selects a choice more than once");
  }
}

/** Zeroed totals for every contest and choice in the manifest. */
export function zeroTotals(manifest: ElectionManifest): ContestTotals {
  const totals: ContestTotals = Object.create(null);
  for (const contest of manifest.contests) {
    const row: Record<string, number> = Object.create(null);
    for (const choice of contest.choices) row[choice.id] = 0;
    totals[contest.id] = row;
  }
  return totals;
}

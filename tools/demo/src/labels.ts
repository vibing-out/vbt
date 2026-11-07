// Labels A to E for a demo set's five ballots. Assigned by sorting the tracking codes, which are hashes,
// so a label never reflects the order the ballots were cast in (locked Principle 5). Seed and run both use
// this one rule, so nothing new is stored.

export const LABELS = Object.freeze(["A", "B", "C", "D", "E"] as const);

export type Label = (typeof LABELS)[number];

export const SET_SIZE = LABELS.length;

/** Maps A to E onto exactly five distinct tracking codes, in sorted code order. */
export function labelBallots(codes: readonly string[]): Record<Label, string> {
  const sorted = [...codes].sort();
  if (sorted.length !== SET_SIZE || new Set(sorted).size !== SET_SIZE) {
    throw new Error(`a demo set has exactly ${SET_SIZE} distinct ballots, got ${codes.length}`);
  }
  return Object.fromEntries(LABELS.map((label, i) => [label, sorted[i]])) as Record<Label, string>;
}

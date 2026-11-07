import type { BallotPlaintext, ElectionManifest } from "./manifest.js";

export const manifest: ElectionManifest = {
  contests: [
    { id: "mayor", choices: [{ id: "alvarez" }, { id: "brooks" }, { id: "chen" }] },
    { id: "measure-a", choices: [{ id: "yes" }, { id: "no" }] },
    { id: "council", choices: [{ id: "d" }, { id: "e" }, { id: "f" }, { id: "g" }] },
  ],
};

export const ballotA: BallotPlaintext = {
  contests: [
    { contestId: "mayor", choiceIds: ["alvarez"] },
    { contestId: "measure-a", choiceIds: ["yes"] },
    { contestId: "council", choiceIds: ["d", "f"] },
  ],
};

export const ballotB: BallotPlaintext = {
  contests: [
    { contestId: "mayor", choiceIds: ["chen"] },
    { contestId: "measure-a", choiceIds: ["yes"] },
    { contestId: "council", choiceIds: ["f"] },
  ],
};

/** Undervote: skips measure-a entirely. */
export const ballotC: BallotPlaintext = {
  contests: [
    { contestId: "mayor", choiceIds: ["alvarez"] },
    { contestId: "council", choiceIds: [] },
  ],
};

export function flipByte(bytes: Uint8Array, index: number): Uint8Array {
  const copy = bytes.slice();
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
}

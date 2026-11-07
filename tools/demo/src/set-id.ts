// Demo set ids and the precinct, county and machine each set gets (human decision 1 on #49: every set has
// its own clearly named precinct and county, so a run's county batches never touch other ballots).
// Pure: no I/O. The id is computed from the set id alone, so the route can build its requireRole target
// before doing any work.

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"; // RFC 4648 base32, lower case
const SET_ID = /^demo-[a-z2-7]{6}$/;

/** Random bytes source; defaults to the Web Crypto CSPRNG. Injected in tests. */
export type RandomBytes = (length: number) => Uint8Array;

const defaultRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/** A fresh set id: `demo-` and 6 base32 characters (30 bits). */
export function newSetId(random: RandomBytes = defaultRandom): string {
  const bytes = random(6);
  let id = "demo-";
  for (let i = 0; i < 6; i++) id += ALPHABET[(bytes[i] ?? 0) % 32];
  return id;
}

/** True for a well-formed set id. Anything else is refused before it reaches a query or a path. */
export function isSetId(value: unknown): value is string {
  return typeof value === "string" && SET_ID.test(value);
}

function assertSetId(setId: string): string {
  if (!isSetId(setId)) throw new Error(`not a demo set id: ${setId}`);
  return setId;
}

/** The set's own precinct id. */
export const demoPrecinctId = (setId: string): string => `${assertSetId(setId)}-p`;

/** The set's own county id (precincts.county_id is free text; there is no counties table). */
export const demoCountyId = (setId: string): string => `${assertSetId(setId)}-c`;

/** The set's one simulated machine. */
export const demoMachineId = (setId: string): string => `${assertSetId(setId)}-m1`;

/** The precinct's public name, so demo ballots are obvious in the public record. */
export const demoPrecinctName = (setId: string): string => `Judges' demo ${assertSetId(setId)} (precinct)`;

/** The county name printed on the demo receipts. */
export const demoCountyName = (setId: string): string => `Judges' demo ${assertSetId(setId)} county`;

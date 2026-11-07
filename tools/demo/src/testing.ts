// Test helpers for @vbt/demo consumers (apps/web route and page tests). Never imported by app code.
export { fakeClock } from "./clock.ts";
export { type ApiMethod, type StubCall, type StubEvent, type StubOptions, type StubWorld, stubWorld, WRITE_METHODS } from "./stubs.ts";

import type { Clock } from "./ports.ts";
import { seedSet, type SeedResult } from "./seed.ts";
import { type StubOptions, stubWorld } from "./stubs.ts";

/** A stub world with one freshly seeded set, ready to run. */
export async function seededWorld(clock: Clock, options: StubOptions = {}) {
  const world = stubWorld(clock, options);
  let n = 0;
  const seed: SeedResult = await seedSet({
    ...world,
    // Deterministic "random" bytes, so set ids and file names are stable in tests.
    random: (length) => Uint8Array.from({ length }, () => (n++ * 37 + 11) % 256),
  });
  return { world, seed };
}

// The real clock for the route and the CLI. Monotonic (performance.now), so a wall-clock change mid-run
// can't skip or repeat a step. Tests use fakeClock from testing.ts instead.

import type { Clock } from "./ports.ts";

export const realClock: Clock = {
  now: () => performance.now(),
  sleepUntil: (at) =>
    new Promise((resolve) => {
      const wait = at - performance.now();
      if (wait <= 0) resolve();
      else setTimeout(resolve, wait);
    }),
};

/** A clock whose sleeps return at once (for the CLI's --stub dry run and tests). */
export function fakeClock(start = 0): Clock & { advance(ms: number): void } {
  let t = start;
  return {
    now: () => t,
    sleepUntil: async (at) => {
      if (at > t) t = at;
      await Promise.resolve();
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

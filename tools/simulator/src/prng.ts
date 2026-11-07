// Deterministic PRNG: FNV-1a seed hash feeding Mulberry32.
// Generation must never use Math.random or crypto.randomUUID.

/** FNV-1a 32-bit hash of a string, as an unsigned 32-bit integer. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates shuffle of a copy; the input is not modified. */
  shuffle<T>(items: readonly T[]): T[];
  /** Pick by relative weights (they need not sum to 1). */
  weightedPick<T>(items: ReadonlyArray<{ value: T; weight: number }>): T;
  /** 8 lowercase hex characters. */
  hex8(): string;
  /** `${prefix}-` followed by 8 hex characters. */
  id(prefix: string): string;
}

export function createRng(seed: string): Rng {
  let state = hashSeed(seed);

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };

  const next = (): number => nextUint32() / 4294967296;

  const int = (n: number): number => {
    if (!Number.isInteger(n) || n < 1) throw new RangeError(`int(n) needs an integer n ≥ 1, got ${n}`);
    return Math.floor(next() * n);
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new RangeError("pick() from an empty array");
    return items[int(items.length)] as T;
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  };

  const weightedPick = <T>(items: ReadonlyArray<{ value: T; weight: number }>): T => {
    const total = items.reduce((s, it) => s + it.weight, 0);
    if (items.length === 0 || !(total > 0)) throw new RangeError("weightedPick() needs positive weights");
    let r = next() * total;
    for (const it of items) {
      r -= it.weight;
      if (r < 0) return it.value;
    }
    return (items[items.length - 1] as { value: T }).value;
  };

  const hex8 = (): string => nextUint32().toString(16).padStart(8, "0");

  const id = (prefix: string): string => `${prefix}-${hex8()}`;

  return { next, int, pick, shuffle, weightedPick, hex8, id };
}

/** Derived stream seeds, so each concern can be recomputed independently. */
export const streamSeed = {
  ballots: (seed: string): string => `${seed}:ballots`,
  faults: (seed: string): string => `${seed}:faults`,
} as const;

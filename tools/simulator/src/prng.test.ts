import { describe, expect, it } from "vitest";
import { createRng, hashSeed } from "./prng.ts";

const draw = (seed: string, n = 50): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe("prng", () => {
  it("gives the same sequence for the same seed", () => {
    expect(draw("1")).toEqual(draw("1"));
  });

  it("diverges for different seeds", () => {
    expect(draw("1")).not.toEqual(draw("2"));
    expect(hashSeed("1")).not.toBe(hashSeed("2"));
  });

  it("stays in range and keeps helpers deterministic", () => {
    const rng = createRng("range");
    for (let i = 0; i < 1000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const k = rng.int(7);
      expect(Number.isInteger(k) && k >= 0 && k < 7).toBe(true);
    }
    expect(createRng("s").id("ballot")).toMatch(/^ballot-[0-9a-f]{8}$/);
    expect(createRng("s").id("ballot")).toBe(createRng("s").id("ballot"));
    const items = Array.from({ length: 20 }, (_, i) => i);
    const shuffled = createRng("s").shuffle(items);
    expect(shuffled).toEqual(createRng("s").shuffle(items));
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    expect(items[0]).toBe(0); // input not mutated
  });

  it("weightedPick follows weights roughly", () => {
    const rng = createRng("w");
    let a = 0;
    for (let i = 0; i < 4000; i++) if (rng.weightedPick([{ value: "a", weight: 3 }, { value: "b", weight: 1 }]) === "a") a++;
    expect(a / 4000).toBeGreaterThan(0.7);
    expect(a / 4000).toBeLessThan(0.8);
  });
});

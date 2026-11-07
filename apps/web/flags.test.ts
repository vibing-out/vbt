import { beforeEach, expect, test, vi } from "vitest";

// The Vercel adapter is mocked so each test decides what it returns; flags.ts is evaluated for real.
const decide = vi.hoisted(() => vi.fn<() => Promise<boolean | undefined>>());
vi.mock("@flags-sdk/vercel", () => ({
  vercelAdapter: () => ({ origin: { provider: "vercel" }, config: { reportValue: false }, decide }),
}));

const flags = await import("./flags");
const all = Object.values(flags);
const keys = ["mismatch-view", "challenge-discard-flow", "state-level-status"];

// Outside App Router a flag needs a request to read headers and the override cookie from.
const evaluate = (f: (typeof all)[number]) => f.run({ identify: {}, request: new Request("http://localhost/") });

beforeEach(() => {
  decide.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

test("flags.ts exports exactly the three demo flags, each on by default with a description", () => {
  expect(Object.keys(flags).sort()).toEqual(["challengeDiscardFlow", "mismatchView", "stateLevelStatus"]);
  expect(all.map((f) => f.key)).toEqual(keys);
  for (const f of all) {
    expect(f.defaultValue, f.key).toBe(true);
    expect(typeof f.description, f.key).toBe("string");
    expect(f.description?.trim(), f.key).not.toBe("");
    expect(f.options?.map((o) => o.value).sort(), f.key).toEqual([false, true]);
  }
});

test("the state-level-status description says the roll-up is shown by date only", () => {
  expect(flags.stateLevelStatus.description).toBe(
    "The statewide public roll-up of county stage records and check results, shown by date only.",
  );
});

test.each(keys)("%s evaluates to true when the adapter throws", async (key) => {
  decide.mockRejectedValue(new Error("Vercel unreachable"));
  expect(await evaluate(all.find((f) => f.key === key)!)).toBe(true);
});

test.each(keys)("%s evaluates to true when the adapter returns undefined", async (key) => {
  decide.mockResolvedValue(undefined);
  expect(await evaluate(all.find((f) => f.key === key)!)).toBe(true);
});

test.each(keys)("%s follows the adapter when it returns a value", async (key) => {
  decide.mockResolvedValue(false);
  expect(await evaluate(all.find((f) => f.key === key)!)).toBe(false);
});

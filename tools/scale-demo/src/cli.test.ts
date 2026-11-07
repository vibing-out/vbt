import pg from "pg";
import { afterEach, expect, test, vi } from "vitest";
import { main, parseOptions, RUN_BUDGET_MS } from "./cli.ts";
import { E3_PENDING } from "./crypto-adapter.ts";
import { FAKE_KEY_ENV, fakeCrypto } from "./testing/fake-crypto.ts";
import type { SeedConnection } from "./write.ts";

afterEach(() => vi.restoreAllMocks());

const nullConnection = (): SeedConnection => ({ connect: async () => undefined, end: async () => undefined, query: async () => ({ rows: [] }) });

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, deps: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
}

/** A clock that advances `stepMs` per reading. */
const clock = (stepMs: number) => {
  let t = 0;
  return () => (t += stepMs);
};

const SMALL = ["--ballots", "200", "--precincts", "4", "--rate", "0.05"];
const LOCAL_ENV = { ...FAKE_KEY_ENV, PRODUCT_DATABASE_URL: "postgresql://postgres@localhost:5432/scratch" };

test("AC5: with default dependencies the CLI exits non-zero with E3_PENDING and never connects", async () => {
  const connect = vi.spyOn(pg.Client.prototype, "connect");
  const c = capture();
  const code = await main(["--yes"], { env: { ...FAKE_KEY_ENV, PRODUCT_DATABASE_URL: "postgresql://postgres@db.example.com/postgres" }, ...c.deps });
  expect(code).toBe(1);
  expect(c.err.join("\n")).toContain(E3_PENDING);
  expect(connect).not.toHaveBeenCalled();
});

test("AC6: a run over 120 s by the clock exits 1 and says so", async () => {
  const c = capture();
  const code = await main([...SMALL, "--yes"], { env: LOCAL_ENV, crypto: fakeCrypto(), connect: nullConnection, now: clock(RUN_BUDGET_MS + 1), ...c.deps });
  expect(code).toBe(1);
  expect(c.err).toEqual([expect.stringMatching(/the run took 120\.0 s, over the 120 s budget/)]);
});

test("AC6: a run inside the budget exits 0 and prints the elapsed time", async () => {
  const c = capture();
  const code = await main([...SMALL, "--yes"], { env: LOCAL_ENV, crypto: fakeCrypto(), connect: nullConnection, now: clock(1_500), ...c.deps });
  expect(code).toBe(0);
  expect(c.out.at(-1)).toBe("elapsed 1.5 s (budget 120 s)");
  expect(c.out).toContain("total  ballots 200  tallied 190  challenged 10");
});

test("without --yes it is a dry run: the full plan's counts, no crypto, no connection", async () => {
  const connect = vi.fn(nullConnection);
  const c = capture();
  const code = await main([], { env: {}, connect, ...c.deps });
  expect(code).toBe(0);
  expect(connect).not.toHaveBeenCalled();
  expect(c.out[0]).toMatch(/^scale-demo dry run \(pass --yes to write\)/);
  expect(c.out.filter((l) => l.startsWith("SCALE-DEMO-"))).toHaveLength(20);
  expect(c.out.at(-1)).toBe("total  ballots 10000  tallied 9950  challenged 50");
});

test("it refuses to run under CI", async () => {
  const connect = vi.fn(nullConnection);
  const c = capture();
  expect(await main(["--yes"], { env: { ...LOCAL_ENV, CI: "true" }, crypto: fakeCrypto(), connect, ...c.deps })).toBe(1);
  expect(c.err[0]).toMatch(/refusing to seed under CI/);
  expect(connect).not.toHaveBeenCalled();
});

test("AC8: output lines hold counts only: no tracking codes, ids, hashes, ciphertext or times", async () => {
  const c = capture();
  await main([...SMALL, "--yes"], { env: LOCAL_ENV, crypto: fakeCrypto(), connect: nullConnection, now: clock(10), ...c.deps });
  const text = [...c.out, ...c.err].join("\n");
  expect(text).not.toMatch(/[A-Z]{3,8}-[A-Z]{3,8}-[0-9A-Z]{4}-[A-Z]{3,8}/); // tracking codes
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // uuids
  expect(text).not.toMatch(/[0-9a-f]{32}/); // hashes
  expect(text).not.toMatch(/\d{1,2}:\d{2}|T\d{2}|2026-/); // times and dates
  expect(text).not.toMatch(/M-SCALE|prev|ciphertext|occurred|recorded/i);
});

test("bad arguments exit 1 with a message", async () => {
  for (const argv of [["--ballots", "lots"], ["--rate", ""], ["--nope"], ["--precincts", "0"]]) {
    const c = capture();
    expect(await main(argv, { env: {}, ...c.deps }), argv.join(" ")).toBe(1);
    expect(c.err[0]).toMatch(/^scale-demo: /);
  }
});

test("defaults are the full run", () => {
  expect(parseOptions([])).toEqual({ options: { ballots: 10_000, precincts: 20, rate: 0.005, seed: "vbt-scale-demo" }, yes: false });
});

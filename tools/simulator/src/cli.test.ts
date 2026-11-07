import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { main, parseCliArgs } from "./cli.ts";
import { BIN } from "./test/helpers.ts";

const PKG = new URL("..", import.meta.url).pathname;
// How to call pnpm: the running pnpm script's entry, else pnpm on PATH, else none.
const pnpmCmd: string[] | undefined = process.env.npm_execpath?.includes("pnpm")
  ? [process.execPath, process.env.npm_execpath]
  : spawnSync("pnpm", ["--version"]).status === 0
    ? ["pnpm"]
    : undefined;

const runBin = (args: string[]) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd: PKG });

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "vbt-sim-cli-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("simulate bin (AC6)", () => {
  it("--help exits 0 and prints usage", () => {
    const r = runBin(["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^simulate \[options\]/);
    expect(r.stdout).toContain("--mismatch-rate");
  });

  it("missing --out exits non-zero with a clear message", () => {
    const r = runBin(["--ballots", "10"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("--out <dir> is required");
  });

  it("writes a run and prints a one-line summary", async () => {
    const out = join(root, "bin-run");
    const r = runBin(["--", "--ballots", "100", "--mismatch-rate", "0.02", "--seed", "1", "--out", out]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`wrote 100 ballots, 4 machines, 2 faults → ${out}\n`);
    expect(await readdir(join(out, "cvrs"))).toHaveLength(100);
  });

  it.skipIf(!pnpmCmd)("is wired as a package bin: pnpm --filter simulator exec simulate", () => {
    const [cmd, ...pre] = pnpmCmd as [string, ...string[]];
    const out = join(root, "pnpm-run");
    const r = spawnSync(
      cmd,
      [...pre, "--filter", "simulator", "exec", "simulate", "--ballots", "100", "--mismatch-rate", "0.02", "--seed", "1", "--out", out],
      { encoding: "utf8", cwd: PKG },
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("wrote 100 ballots, 4 machines, 2 faults");
  });
});

describe("argument parsing", () => {
  const silent = { stdout: () => {}, stderr: () => {} };

  it.each([
    [["--out", "x"], /--ballots is required/],
    [["--out", "x", "--ballots", "0"], /--ballots must be an integer/],
    [["--out", "x", "--ballots", "1.5"], /--ballots must be an integer/],
    [["--out", "x", "--ballots", "5", "--mismatch-rate", "1.5"], /--mismatch-rate/],
    [["--out", "x", "--ballots", "5", "--mismatch-rate", "abc"], /--mismatch-rate/],
    [["--out", "x", "--ballots", "5", "--machines", "0"], /--machines/],
    [["--out", "x", "--ballots", "5", "--precincts", "-1"], /precincts/],
    [["--out", "x", "--ballots", "5", "--bogus"], /bogus/],
  ])("rejects %j", async (args, message) => {
    expect(() => parseCliArgs(args)).toThrow(message);
    expect(await main(args, silent)).not.toBe(0);
  });

  it("applies defaults", () => {
    expect(parseCliArgs(["--ballots", "3", "--out", "o"]).options).toEqual({
      ballots: 3,
      mismatchRate: 0,
      seed: "0",
      machines: 4,
      precincts: 2,
    });
  });
});

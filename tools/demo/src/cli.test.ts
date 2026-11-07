import { describe, expect, test } from "vitest";
import { type CliDeps, main, parseCliArgs } from "./cli.ts";
import { STEPS, type RunLine } from "./timeline.ts";
import { fakeClock, seededWorld } from "./testing.ts";

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, deps: { env: {}, out: (l: string) => out.push(l), err: (l: string) => err.push(l) } satisfies CliDeps };
}

describe("parseCliArgs", () => {
  test("seed and run", () => {
    expect(parseCliArgs(["seed"])).toEqual({ command: "seed", baseUrl: "https://www.ballottrack.org", out: "out", stub: false });
    expect(parseCliArgs(["seed", "--out", "x", "--base-url", "https://preview.example"])).toMatchObject({ out: "x", baseUrl: "https://preview.example" });
    expect(parseCliArgs(["run", "--set", "demo-abcdef"])).toEqual({ command: "run", baseUrl: "https://www.ballottrack.org", setId: "demo-abcdef", stub: false });
    expect(parseCliArgs(["run", "--stub"])).toMatchObject({ command: "run", setId: null, stub: true });
  });

  test.each([
    [[], /no command/],
    [["reset"], /unknown command/],
    [["run"], /needs --set/],
    [["run", "--set", "18097"], /not a demo set id/],
    [["run", "--set", "demo-abcdef", "--out", "x"], /no --out/],
    [["seed", "--set", "demo-abcdef"], /fresh set/],
    [["seed", "--base-url", "ftp://x"], /http\(s\)/],
    [["seed", "--bogus"], /Unknown option/],
  ])("refuses %j", (argv, message) => {
    expect(parseCliArgs(argv)).toEqual({ error: expect.stringMatching(message) });
  });
});

describe("demo run --set <id> runs the same runTimeline (AC 6, AC 7)", () => {
  test("prints the same NDJSON lines as the route streams, and exits 0", async () => {
    const clock = fakeClock();
    const { world, seed } = await seededWorld(clock);
    const { out, deps } = io();
    const code = await main(["run", "--set", seed.setId], {
      ...deps,
      clock,
      adapters: () => ({ simulator: world.simulator, receipts: world.receipts }),
      connect: async () => ({ api: world.api, registry: world.registry }),
    });
    expect(code).toBe(0);
    const lines = out.map((l) => JSON.parse(l) as RunLine);
    expect(lines.map((l) => l.type)).toEqual(["started", ...STEPS.map(() => "step"), "finished"]);
    expect(lines.at(-1)).toMatchObject({ ok: true, statuses: { A: "CERTIFIED", D: "SPOILED", E: "DISCARDED" } });
  });

  test("a set that already ran: refused with exit 3 and no writes", async () => {
    const clock = fakeClock();
    const { world, seed } = await seededWorld(clock);
    const ports = {
      clock,
      adapters: () => ({ simulator: world.simulator, receipts: world.receipts }),
      connect: async () => ({ api: world.api, registry: world.registry }),
    };
    expect(await main(["run", "--set", seed.setId], { ...io().deps, ...ports })).toBe(0);
    const writes = world.events().length;
    const second = io();
    expect(await main(["run", "--set", seed.setId], { ...second.deps, ...ports })).toBe(3);
    expect(JSON.parse(second.err[0]!)).toMatchObject({ type: "refused", reason: "already-ran" });
    expect(second.out).toEqual([]);
    expect(world.events().length).toBe(writes);
  });

  test("without the real simulator adapter it refuses before signing in", async () => {
    let connected = false;
    const { err, deps } = io();
    const code = await main(["run", "--set", "demo-abcdef"], {
      ...deps,
      connect: async () => {
        connected = true;
        throw new Error("unreachable");
      },
    });
    expect(code).toBe(1);
    expect(connected).toBe(false);
    expect(err.join("\n")).toMatch(/not wired yet.*Nothing was written/);
  });

  test("bad arguments exit 2 with usage", async () => {
    const { err, deps } = io();
    expect(await main(["run"], deps)).toBe(2);
    expect(err.join("\n")).toContain("Usage:");
  });
});

describe("--stub dry run", () => {
  test("run --stub seeds in memory and runs the whole timeline", async () => {
    const { out, err, deps } = io();
    expect(await main(["run", "--stub"], deps)).toBe(0);
    expect(err[0]).toMatch(/in memory/);
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ type: "finished", ok: true, overran: false });
  });

  test("seed --stub prints the set, five tracker links and the Demo control link", async () => {
    const { out, deps } = io();
    expect(await main(["seed", "--stub", "--base-url", "https://preview.example"], deps)).toBe(0);
    expect(out.filter((l) => /^ {2}[A-E] {2}https:\/\/www\.ballottrack\.org\/track\//.test(l))).toHaveLength(5);
    expect(out.join("\n")).toMatch(/Demo control: https:\/\/preview\.example\/official\/demo\?set=demo-[a-z2-7]{6}/);
  });
});

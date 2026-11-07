import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mismatchView: vi.fn(async () => true),
  challengeDiscardFlow: vi.fn(async () => true),
  stateLevelStatus: vi.fn(async () => true),
}));
vi.mock("../flags", () => mocks);

const { getDemoFlags } = await import("./demo-flags");

beforeEach(() => vi.clearAllMocks());

test("returns every demo flag on when all are on", async () => {
  expect(await getDemoFlags()).toEqual({ mismatchView: true, challengeDiscardFlow: true, stateLevelStatus: true });
  for (const f of Object.values(mocks)) expect(f).toHaveBeenCalledOnce();
});

test.each([
  [{ mismatchView: false, challengeDiscardFlow: true, stateLevelStatus: true }],
  [{ mismatchView: true, challengeDiscardFlow: false, stateLevelStatus: true }],
  [{ mismatchView: true, challengeDiscardFlow: true, stateLevelStatus: false }],
  [{ mismatchView: false, challengeDiscardFlow: true, stateLevelStatus: false }],
])("maps each flag to its own field: %o", async (values) => {
  mocks.mismatchView.mockResolvedValueOnce(values.mismatchView);
  mocks.challengeDiscardFlow.mockResolvedValueOnce(values.challengeDiscardFlow);
  mocks.stateLevelStatus.mockResolvedValueOnce(values.stateLevelStatus);
  expect(await getDemoFlags()).toEqual(values);
});

test("is marked server-only, so a client import fails the build", () => {
  expect(readFileSync(join(import.meta.dirname, "demo-flags.ts"), "utf8")).toMatch(/^import "server-only";/m);
});

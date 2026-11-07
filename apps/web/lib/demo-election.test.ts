import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { lookup, normalizeCode, sampleCodes } = await import("./demo-election");

describe("demo election tracker data", () => {
  test("a certified ballot shows every stage with a passing inclusion check", () => {
    const [certified] = sampleCodes();
    const view = lookup(certified!.code)!;
    expect(view.status).toBe("CERTIFIED");
    expect(view.timeline.map((t) => t.status)).toEqual(["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED"]);
    expect(view.allChecksPass).toBe(true);
  });

  test("codes are normalized and unknown codes return null", () => {
    const [certified] = sampleCodes();
    expect(lookup(` ${certified!.code.toLowerCase()} `)?.trackingCode).toBe(certified!.code);
    expect(lookup("NOT-A-REAL-CODE")).toBeNull();
    expect(normalizeCode("river maple")).toBe("RIVER-MAPLE");
  });

  test("a discarded ballot shows its reason; nothing exposes a time", () => {
    const discarded = sampleCodes().find((s) => s.note.startsWith("Not counted"))!;
    const view = lookup(discarded.code)!;
    expect(view.status).toBe("DISCARDED");
    expect(view.reason).toBeTruthy();
    expect(JSON.stringify(view)).not.toMatch(/T\d{2}:\d{2}/);
  });
});

// Acceptance (T-10): the mapping table only uses locked event types, keeps the vendor Event.Id as
// nist_event_code, and docs/nist-mapping.md lists every code in it.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { importCdfLogJson } from "./cdf-log-json.ts";
import { EVENT_TYPES, isEventType } from "./event-types.ts";
import { lookupNistCode, NIST_CODES } from "./nist-codes.ts";

const doc = readFileSync(new URL("../../../docs/nist-mapping.md", import.meta.url), "utf8");
const locked = readFileSync(new URL("../../../docs/locked-interfaces.md", import.meta.url), "utf8");

describe("event types", () => {
  test("are exactly the locked event_type list", () => {
    const row = locked.split("\n").find((line) => line.startsWith("| `event_type` |"))!;
    expect([...row.matchAll(/`([A-Z_]+)`/g)].map((m) => m[1])).toEqual([...EVENT_TYPES]);
    expect(isEventType("CAST")).toBe(true);
    expect(isEventType("cast")).toBe(false);
    expect(isEventType(1)).toBe(false);
  });
});

describe("the NIST code table", () => {
  test("maps every event_type it names to a locked one, and only vote-cast to a ballot event", () => {
    for (const c of NIST_CODES) if (c.eventType !== null) expect(EVENT_TYPES).toContain(c.eventType);
    expect(NIST_CODES.filter((c) => c.eventType !== null).map((c) => [c.code, c.eventType])).toEqual([["vote-cast", "CAST"]]);
  });

  test("has each code once, in VotingWorks' kebab-case", () => {
    const codes = NIST_CODES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  test("leaves ballot-invalidated unmapped rather than guessing SPOILED", () => {
    expect(lookupNistCode("ballot-invalidated")).toBeUndefined();
    expect(lookupNistCode("vote-cast")).toMatchObject({ use: "ballot-count", eventType: "CAST" });
    expect(lookupNistCode("unknown-error")).toMatchObject({ use: "error", eventType: null });
  });

  test("nist_event_code is the vendor Event.Id, unchanged", () => {
    const ids = [...NIST_CODES.map((c) => c.code), "ballot-invalidated", "Vendor.Custom_42"];
    const log = {
      "@type": "EventLogging.ElectionEventLog",
      GeneratedTime: "2026-11-03T19:00:00Z",
      Device: [
        {
          "@type": "EventLogging.Device",
          Id: "M1",
          Event: ids.map((Id, i) => ({ "@type": "EventLogging.Event", Id, Sequence: String(i), TimeStamp: "t", Type: "x", Disposition: "success" })),
        },
      ],
    };
    const result = importCdfLogJson(JSON.stringify(log));
    expect(result.ok && result.value.events.map((e) => e.nist_event_code)).toEqual(ids);
  });

  test("docs/nist-mapping.md lists every code in the table", () => {
    expect(NIST_CODES.filter((c) => !doc.includes(`\`${c.code}\``)).map((c) => c.code)).toEqual([]);
  });
});

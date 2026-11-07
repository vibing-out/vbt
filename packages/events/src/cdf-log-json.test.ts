// Acceptance (T-10): the 1500-101 JSON parser follows NIST's V1 schema, counts only successful vote-cast
// events, and reports unknown Event.Ids.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { importCdfLogJson } from "./cdf-log-json.ts";
import { MAX_IMPORT_BYTES } from "./parse.ts";

const SAMPLE = readFileSync(new URL("../fixtures/log-sample.json", import.meta.url), "utf8");

type J = Record<string, unknown>;
const event = (overrides: J = {}): J => ({
  "@type": "EventLogging.Event",
  Id: "vote-cast",
  Sequence: "1",
  TimeStamp: "2026-11-03T06:00:00-05:00",
  Type: "user-action",
  Disposition: "success",
  ...overrides,
});
const log = (events: unknown[], device: J = {}): J => ({
  "@type": "EventLogging.ElectionEventLog",
  GeneratedTime: "2026-11-03T19:00:00-05:00",
  Device: [{ "@type": "EventLogging.Device", Id: "M1", Event: events, ...device }],
});
const read = (value: unknown) => importCdfLogJson(JSON.stringify(value));
const errors = (value: unknown) => {
  const result = read(value);
  return result.ok ? [] : result.errors;
};

describe("a valid log", () => {
  test("is summarized per device: counts, poll flags, errors and unmapped codes", () => {
    const result = importCdfLogJson(SAMPLE);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        format: "cdf-json",
        electionId: "2026-general",
        machines: [
          { machineId: "M-001-A", ballotsCounted: 2, pollsOpened: true, pollsClosed: true, errorCount: 2, unmappedCodes: ["ballot-invalidated"] },
          { machineId: "M-001-B", ballotsCounted: 1, pollsOpened: true, pollsClosed: false, errorCount: 0, unmappedCodes: [] },
        ],
      }),
    });
  });

  test("vote-cast events whose Disposition is failure are not counted", () => {
    const result = read(log([event(), event({ Disposition: "failure" }), event({ Disposition: "na" }), event({ Disposition: "other" })]));
    expect(result.ok && result.value.machines[0]).toMatchObject({ ballotsCounted: 1, errorCount: 1 });
  });

  test("polls events count only when they succeeded", () => {
    const result = read(log([event({ Id: "polls-opened", Disposition: "failure" }), event({ Id: "polls-closed", Disposition: "na" })]));
    expect(result.ok && result.value.machines[0]).toMatchObject({ pollsOpened: false, pollsClosed: false, errorCount: 1 });
  });

  test("unknown Event.Ids appear in unmappedCodes, sorted and unique, and are never counted", () => {
    const result = read(log([event({ Id: "zz-custom" }), event({ Id: "ballot-invalidated" }), event({ Id: "zz-custom" })]));
    expect(result.ok && result.value.machines[0]).toMatchObject({ ballotsCounted: 0, unmappedCodes: ["ballot-invalidated", "zz-custom"] });
  });

  test("normalized events carry no time or sequence number", () => {
    const result = importCdfLogJson(SAMPLE);
    expect(result.ok && result.value.events[1]).toEqual({
      machineId: "M-001-A",
      nist_event_code: "vote-cast",
      event_type: "CAST",
      use: "ballot-count",
      disposition: "success",
    });
    expect(JSON.stringify(result)).not.toMatch(/2026-11-03T|TimeStamp|Sequence/);
  });

  test("a log with no devices, or a device with no events, is valid", () => {
    expect(read({ "@type": "EventLogging.ElectionEventLog", GeneratedTime: "t" })).toEqual({
      ok: true,
      value: { format: "cdf-json", electionId: null, machines: [], events: [] },
    });
    expect(read(log([], { Event: undefined }))).toMatchObject({ ok: true, value: { machines: [{ machineId: "M1", ballotsCounted: 0 }] } });
  });
});

describe("schema rules", () => {
  test.each(["Id", "Sequence", "TimeStamp", "Type", "Disposition"])("rejects an Event without %s", (field) => {
    const e = event();
    delete e[field];
    expect(errors(log([e]))).toEqual([expect.stringContaining(`$.Device[0].Event[0].${field}: expected`)]);
  });

  test.each([
    ["the log", { "@type": "EventLogging.Log", GeneratedTime: "t" }, "$.@type"],
    ["a device", log([], { "@type": "Device" }), "$.Device[0].@type"],
    ["an event", log([event({ "@type": "EventLogging.Device" })]), "$.Device[0].Event[0].@type"],
  ])("rejects a wrong @type on %s", (_, value, path) => {
    expect(errors(value)).toEqual([expect.stringContaining(path)]);
  });

  test.each(["succeeded", "SUCCESS", 1, null])("rejects Disposition %j", (disposition) => {
    expect(errors(log([event({ Disposition: disposition })]))).toEqual(["$.Device[0].Event[0].Disposition: expected one of failure, na, other, success"]);
  });

  test("rejects a missing GeneratedTime, a missing or repeated Device.Id, and non-array lists", () => {
    expect(errors({ "@type": "EventLogging.ElectionEventLog" })).toEqual(["$.GeneratedTime: expected a non-empty string"]);
    expect(errors(log([event()], { Id: "" }))).toEqual(["$.Device[0].Id: expected a non-empty string"]);
    const twice = log([]);
    (twice.Device as J[]).push({ "@type": "EventLogging.Device", Id: "M1" });
    expect(errors(twice)).toEqual(["$.Device[1].Id: expected a device Id not already in this log"]);
    expect(errors({ "@type": "EventLogging.ElectionEventLog", GeneratedTime: "t", Device: {} })).toEqual(["$.Device: expected an array"]);
    expect(errors(log("x" as unknown as unknown[]))).toEqual(["$.Device[0].Event: expected an array"]);
  });

  test("rejects an ElectionId that is not a non-empty string", () => {
    expect(errors({ "@type": "EventLogging.ElectionEventLog", GeneratedTime: "t", ElectionId: 7 })).toEqual(["$.ElectionId: expected a non-empty string"]);
  });

  test("rejects non-objects, non-JSON and oversized files", () => {
    expect(errors([])).toEqual(["$: expected an object"]);
    expect(errors(log([1]))).toEqual(["$.Device[0].Event[0]: expected an object"]);
    expect(importCdfLogJson("not json")).toEqual({ ok: false, errors: ["$: expected JSON"] });
    expect(importCdfLogJson(" ".repeat(MAX_IMPORT_BYTES + 1))).toMatchObject({ ok: false });
  });

  test("errors never echo file contents", () => {
    expect(errors(log([event({ Disposition: "secret-value" })])).join()).not.toContain("secret-value");
  });
});

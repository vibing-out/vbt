// Acceptance (T-10): the 1500-101 XML parser gives the JSON parser's summary for the same log, refuses
// DOCTYPE and ENTITY declarations before parsing, caps file size and checks the NIST namespace.
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { importCdfLogJson } from "./cdf-log-json.ts";
import { CDF_LOG_NAMESPACE, importCdfLogXml } from "./cdf-log-xml.ts";
import { MAX_IMPORT_BYTES } from "./parse.ts";
import { toXml } from "./testing/election-fixture.ts";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const JSON_SAMPLE = fixture("log-sample.json");
const XML_SAMPLE = fixture("log-sample.xml");

const strip = <T extends { format: string }>(value: T) => ({ ...value, format: undefined });

const doc = (body: string, ns = CDF_LOG_NAMESPACE) =>
  `<?xml version="1.0"?><ElectionEventLog xmlns="${ns}"><GeneratedTime>t</GeneratedTime>${body}</ElectionEventLog>`;
const device = (events: string, id = "M1") => `<Device><Id>${id}</Id>${events}</Device>`;
const ev = (id = "vote-cast", disposition = "success") =>
  `<Event><Id>${id}</Id><Sequence>1</Sequence><TimeStamp>t</TimeStamp><Type>user-action</Type><Disposition>${disposition}</Disposition></Event>`;

describe("the same log in XML and JSON", () => {
  test("gives identical summaries and events (default namespace, children in any order)", () => {
    const fromJson = importCdfLogJson(JSON_SAMPLE);
    const fromXml = importCdfLogXml(XML_SAMPLE);
    expect(fromJson.ok && fromXml.ok).toBe(true);
    if (!fromJson.ok || !fromXml.ok) return;
    expect(fromXml.value.format).toBe("cdf-xml");
    expect(strip(fromXml.value)).toEqual(strip(fromJson.value));
  });

  test("gives identical results with a namespace prefix (the fixture writer's form)", () => {
    const json = JSON.parse(JSON_SAMPLE) as Record<string, unknown>;
    const fromXml = importCdfLogXml(toXml(json));
    const fromJson = importCdfLogJson(JSON_SAMPLE);
    expect(fromXml.ok && fromJson.ok && strip(fromXml.value)).toEqual(fromJson.ok && strip(fromJson.value));
  });

  test("applies the same schema rules (via the shared validator)", () => {
    expect(importCdfLogXml(doc(device(ev("vote-cast", "succeeded"))))).toEqual({
      ok: false,
      errors: ["$.Device[0].Event[0].Disposition: expected one of failure, na, other, success"],
    });
    expect(importCdfLogXml(doc(device("<Event><Id>vote-cast</Id><Disposition>success</Disposition></Event>")))).toMatchObject({
      ok: false,
      errors: [expect.stringContaining("Sequence"), expect.stringContaining("TimeStamp"), expect.stringContaining("Type")],
    });
  });
});

describe("XML details", () => {
  test("decodes predefined entities and character references without expanding anything else", () => {
    const result = importCdfLogXml(doc(device(ev("vote&#45;cast") + ev("vote&#x2D;cast") + ev("a&amp;b") + ev("&#99999999;"))));
    expect(result.ok && result.value.machines[0]).toMatchObject({ ballotsCounted: 2, unmappedCodes: ["&#99999999;", "a&b"] });
  });

  test("ignores attributes and elements from other namespaces, and reads an element with attributes as its text", () => {
    const body = device(
      `<x:Extra xmlns:x="urn:other">1</x:Extra><Event><Id xsi:type="s" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">vote-cast</Id><Sequence>1</Sequence><TimeStamp>t</TimeStamp><Type>u</Type><Disposition>success</Disposition></Event>`,
    );
    expect(importCdfLogXml(doc(body))).toMatchObject({ ok: true, value: { machines: [{ ballotsCounted: 1 }] } });
  });

  test("with a prefixed root, unprefixed children are not in the NIST namespace", () => {
    const xml = `<n:ElectionEventLog xmlns:n="${CDF_LOG_NAMESPACE}"><n:GeneratedTime>t</n:GeneratedTime><Device><Id>M1</Id></Device><n:Device><n:Id>M2</n:Id></n:Device></n:ElectionEventLog>`;
    expect(importCdfLogXml(xml)).toMatchObject({ ok: true, value: { machines: [{ machineId: "M2" }] } });
  });

  test("an empty Device element is a device without an Id", () => {
    expect(importCdfLogXml(doc("<Device/>"))).toEqual({ ok: false, errors: ["$.Device[0].Id: expected a non-empty string"] });
  });

  test("a repeated leaf element is rejected, not silently merged", () => {
    expect(importCdfLogXml(doc("<Device><Id>M1</Id><Id>M2</Id></Device>"))).toEqual({
      ok: false,
      errors: ["$.Device[0].Id: expected a non-empty string"],
    });
  });
});

describe("XML safety", () => {
  test.each([
    ["a DOCTYPE", `<?xml version="1.0"?><!DOCTYPE ElectionEventLog [<!ELEMENT a ANY>]>${doc("")}`],
    ["an ENTITY", `<?xml version="1.0"?><!ENTITY x "y">${doc("")}`],
    ["a lower-case doctype", `<!doctype x>${doc("")}`],
    [
      "a billion-laughs payload",
      `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><ElectionEventLog xmlns="${CDF_LOG_NAMESPACE}">&lol2;</ElectionEventLog>`,
    ],
  ])("rejects input containing %s before parsing", async (_, xml) => {
    const { XMLParser } = await import("fast-xml-parser");
    const parse = vi.spyOn(XMLParser.prototype, "parse");
    expect(importCdfLogXml(xml)).toEqual({ ok: false, errors: ["$: expected XML without a DOCTYPE or ENTITY declaration"] });
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  test("rejects input over 10 MB", () => {
    const big = doc(`<Details>${"x".repeat(MAX_IMPORT_BYTES)}</Details>`);
    expect(importCdfLogXml(big)).toEqual({ ok: false, errors: [`$: expected a file of at most ${MAX_IMPORT_BYTES} bytes`] });
  });

  test.each([
    ["a wrong namespace", doc("", "http://itl.nist.gov/ns/voting/1500-101/v2")],
    ["no namespace", `<ElectionEventLog><GeneratedTime>t</GeneratedTime></ElectionEventLog>`],
    ["a prefix bound to another namespace", `<n:ElectionEventLog xmlns:n="urn:x" xmlns="${CDF_LOG_NAMESPACE}"/>`],
    ["a wrong root element", `<ElectionReport xmlns="${CDF_LOG_NAMESPACE}"/>`],
    ["an empty root element with no namespace", "<ElectionEventLog/>"],
  ])("rejects %s", (_, xml) => {
    expect(importCdfLogXml(xml)).toEqual({
      ok: false,
      errors: [`$: expected root element ElectionEventLog in namespace ${CDF_LOG_NAMESPACE}`],
    });
  });

  test.each([
    ["malformed XML", "<ElectionEventLog><Device></ElectionEventLog>"],
    ["an empty file", ""],
    ["plain text", "vote-cast"],
  ])("rejects %s", (_, xml) => {
    expect(importCdfLogXml(xml)).toEqual({ ok: false, errors: ["$: expected well-formed XML"] });
  });

  test("rejects a second, self-closing root element (the well-formedness check lets it through)", () => {
    const root = `<ElectionEventLog xmlns="${CDF_LOG_NAMESPACE}"><GeneratedTime>t</GeneratedTime></ElectionEventLog>`;
    expect(importCdfLogXml(`${root}<Other/>`)).toEqual({
      ok: false,
      errors: ["$: expected one root element"],
    });
  });
});

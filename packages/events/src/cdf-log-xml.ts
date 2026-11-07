// NIST SP 1500-101 event log, XML. The XSD has the same model as the JSON schema, with every field a
// child element (no attributes) in namespace http://itl.nist.gov/ns/voting/1500-101/v1:
// https://raw.githubusercontent.com/usnistgov/ElectionEventLogging/master/NIST_V1_election_event_logging.xsd
// The tree is converted to the JSON shape and validated by cdf-log.ts, so both formats follow one rule set.
//
// XML safety (OWASP XXE Prevention Cheat Sheet; fast-xml-parser entity-expansion advisories fixed in
// 5.10.1): files over MAX_IMPORT_BYTES and any file containing <!DOCTYPE or <!ENTITY are refused before
// the parser sees them, and the parser runs with processEntities off. Only the five predefined XML
// entities and numeric character references are decoded, here, without expansion.

import { XMLParser, XMLValidator } from "fast-xml-parser";
import { type MachineLogImport, readEventLog } from "./cdf-log.ts";
import { type ImportResult, type Json, sizeError } from "./parse.ts";

export const CDF_LOG_NAMESPACE = "http://itl.nist.gov/ns/voting/1500-101/v1";

/** Elements holding repeated typed children; everything else in the model is a text leaf. */
const TYPED: Readonly<Record<string, string>> = { Device: "EventLogging.Device", Event: "EventLogging.Event" };

const fail = (error: string): ImportResult<never> => ({ ok: false, errors: [error] });

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  isArray: (name) => /(^|:)(Device|Event)$/.test(name),
});

const PREDEFINED: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Decodes predefined entities and character references; anything else stays as written. */
function decode(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (whole, name: string) => {
    if (!name.startsWith("#")) return PREDEFINED[name]!;
    const point = name.startsWith("#x") ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}

/** A leaf's text; an element that is not a plain leaf is passed on for the validator to reject. */
function leaf(value: unknown): unknown {
  if (typeof value === "string") return decode(value);
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "#text" in value) {
    return decode(String((value as Json)["#text"]));
  }
  return value;
}

/** Converts one element to the JSON model: children in the NIST namespace only, attributes dropped. */
function toModel(node: unknown, type: string, prefix: string): Json {
  const out: Json = { "@type": type };
  if (typeof node !== "object" || node === null) return out; // an empty element
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_") || key === "#text") continue;
    const local = prefix ? (key.startsWith(`${prefix}:`) ? key.slice(prefix.length + 1) : undefined) : key;
    if (local === undefined || local.includes(":")) continue; // another namespace: not part of the model
    const typed = TYPED[local];
    out[local] = typed ? (value as unknown[]).map((child) => toModel(child, typed, prefix)) : leaf(value);
  }
  return out;
}

/** Imports a 1500-101 XML log from the uploaded file's text. */
export function importCdfLogXml(text: string): ImportResult<MachineLogImport> {
  const tooBig = sizeError(text);
  if (tooBig) return tooBig;
  if (/<!(DOCTYPE|ENTITY)/i.test(text)) return fail("$: expected XML without a DOCTYPE or ENTITY declaration");
  if (XMLValidator.validate(text) !== true) return fail("$: expected well-formed XML");

  const tree = parser.parse(text) as Json;
  const roots = Object.keys(tree);
  if (roots.length !== 1) return fail("$: expected one root element");
  const rootName = roots[0]!;
  const prefix = rootName.includes(":") ? rootName.slice(0, rootName.indexOf(":")) : "";
  const root = tree[rootName];
  const namespace = typeof root === "object" && root !== null ? (root as Json)[prefix ? `@_xmlns:${prefix}` : "@_xmlns"] : undefined;
  if (rootName.slice(prefix ? prefix.length + 1 : 0) !== "ElectionEventLog" || namespace !== CDF_LOG_NAMESPACE) {
    return fail(`$: expected root element ElectionEventLog in namespace ${CDF_LOG_NAMESPACE}`);
  }
  return readEventLog(toModel(root, "EventLogging.ElectionEventLog", prefix), "cdf-xml");
}

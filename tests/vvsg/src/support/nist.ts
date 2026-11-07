// Offline validation against the vendored NIST JSON schemas. The NIST JSON schemas declare draft-04,
// so this uses ajv-draft-04; ajv-formats checks every format they use
// (`date-time`, `date`, `byte`, `uri`). Nothing here uses the network.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv-draft-04";
import formatsPlugin from "ajv-formats";

export const VVSG_DIR = join(import.meta.dirname, "..", "..");
export const SCHEMA_DIR = join(VVSG_DIR, "schemas", "nist");
export const FIXTURE_DIR = join(VVSG_DIR, "fixtures", "simulator");

// ajv-formats is CommonJS; depending on the loader its default import is the plugin or the module object.
const addFormats = ((formatsPlugin as unknown as { default?: unknown }).default ?? formatsPlugin) as (
  ajv: Ajv,
  formats: string[],
) => Ajv;

export type Validate = (value: unknown) => string[];

/** Compiles one vendored schema; the returned function gives "path message" errors, empty when valid. */
export function schemaValidator(file: string): Validate {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv, ["date-time", "date", "byte", "uri"]);
  // NIST's `refTypes` names the type an id refers to. It is an annotation, not a constraint.
  ajv.addKeyword({ keyword: "refTypes", schemaType: "array" });
  const validate = ajv.compile(JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf8")) as object);
  return (value) => {
    if (validate(value)) return [];
    return (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
  };
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Files in a directory other than the provenance notes (*.md). */
export function dataFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => !name.endsWith(".md"))
    .sort();
}

/** Table rows holding a bare file name and a SHA-256 (SOURCES.md, SOURCE.md), keyed by file name. */
export function sourceHashes(markdown: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim().replace(/^`|`$/g, ""));
    const file = cells.find((cell) => /^[^/\s]+\.(json|xsd)$/.test(cell));
    const hash = cells.find((cell) => /^[0-9a-f]{64}$/.test(cell));
    if (file && hash) hashes.set(file, hash);
  }
  return hashes;
}

/**
 * Every object key in a JSON document, with the `@type` of the object that holds it (or "" when the
 * object has none), so a check can allow a key only on certain NIST types.
 */
export function objectKeys(value: unknown, parentType = ""): Array<{ key: string; type: string }> {
  if (Array.isArray(value)) return value.flatMap((item) => objectKeys(item, parentType));
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const type = typeof record["@type"] === "string" ? (record["@type"] as string) : "";
  return Object.entries(record).flatMap(([key, child]) => [{ key, type }, ...objectKeys(child, type)]);
}

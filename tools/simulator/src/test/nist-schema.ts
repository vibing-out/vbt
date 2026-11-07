// Validates JSON against the vendored NIST SP 1500-103 schema with AJV, so the
// AC3 shape check doesn't rely on the simulator's own validator.

import { readFileSync } from "node:fs";
import { Ajv } from "ajv";
import formatsPlugin from "ajv-formats";

const SCHEMA_URL = new URL("../../vendor/nist-sp-1500-103/cvr-minimal.schema.json", import.meta.url);
export const SAMPLE_URL = new URL("../../vendor/nist-sp-1500-103/cvr-sample.json", import.meta.url);

// ajv-formats is CommonJS; under nodenext its default import is the module object.
const addFormats = formatsPlugin as unknown as typeof formatsPlugin.default;

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv, ["date-time"]);
// NIST's `refTypes` names the type an id refers to. It's an annotation only.
ajv.addKeyword({ keyword: "refTypes", schemaType: "array" });

const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA_URL, "utf8")) as object);

/** Returns AJV errors as "path message" strings; empty means schema-valid. */
export function nistSchemaErrors(value: unknown): string[] {
  if (validate(value)) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
}

export function readSample(): unknown {
  return JSON.parse(readFileSync(SAMPLE_URL, "utf8"));
}

// VVSG 2.0 interoperability, the part testable today (T-19): the files the T-06 simulator writes
// (fixtures copied from origin/epic/4, see fixtures/simulator/SOURCE.md) against the official NIST
// schemas (schemas/nist/SOURCES.md). Imports through POST /api/events and a 1500-100 export arrive
// with later tickets; docs/vvsg-map.md names them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { isIdentityName } from "./support/identity.ts";
import {
  dataFiles,
  FIXTURE_DIR,
  objectKeys,
  readJson,
  SCHEMA_DIR,
  schemaValidator,
  sha256File,
  sourceHashes,
} from "./support/nist.ts";

const CVR_SCHEMA = "NIST_V0_cast_vote_records.json";
const EVENT_LOG_SCHEMA = "NIST_V1_election_event_logging.json";

type Fixture = {
  file: string;
  formatModule: string;
  standard: string;
  schema: string;
  /** A required field to delete, to show the validator rejects an incomplete file. */
  requiredPath: string[];
  /** "conforms" must validate; "known-gap" is a documented difference pinned below. */
  status: "conforms" | "known-gap";
};

/** One entry per NIST format module on origin/epic/4 (tools/simulator/src/formats/). */
const FIXTURES: Fixture[] = [
  {
    file: "cvr.ballot-288fa068.cvr.json",
    formatModule: "cvr.ts",
    standard: "NIST SP 1500-103",
    schema: CVR_SCHEMA,
    requiredPath: ["GeneratedDate"],
    status: "conforms",
  },
  {
    file: "cdf-log.mach-01.vx-logs.cdf.json",
    formatModule: "cdf-log.ts",
    standard: "NIST SP 1500-101",
    schema: EVENT_LOG_SCHEMA,
    requiredPath: ["GeneratedTime"],
    status: "known-gap",
  },
];

/** The other format modules on epic/4 and why they have no NIST fixture. */
const NOT_NIST_FORMATS = {
  "manifest.ts": "the simulator's run manifest, not an official format",
  "totals.ts": "simulator-private totals; the simulator README says 'Not an official format'",
};

/** NIST keys with an identity token that name a contest, candidate, place or election, never a voter. */
const NAME_KEY_TYPES = new Set([
  "CVR.Candidate",
  "CVR.CandidateContest",
  "CVR.BallotMeasureContest",
  "CVR.GpUnit",
  "CVR.Election",
]);

const validators = new Map(dataFiles(SCHEMA_DIR).map((schema) => [schema, schemaValidator(schema)]));
const validatorFor = (schema: string) => {
  const validate = validators.get(schema);
  if (!validate) throw new Error(`no vendored schema ${schema}`);
  return validate;
};

function without(value: unknown, path: string[]): unknown {
  const copy = structuredClone(value) as Record<string, unknown>;
  let node: Record<string, unknown> = copy;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
  const last = path[path.length - 1]!;
  expect(node, `fixture has ${path.join(".")}`).toHaveProperty(last);
  delete node[last];
  return copy;
}

/**
 * The simulator's VotingWorks-shaped log rewritten into NIST SP 1500-101 shape with exactly the three
 * changes SOURCE.md lists: unwrap the root, add @type everywhere, and make Sequence a string.
 */
function toNistEventLog(file: unknown): unknown {
  const log = (file as { ElectionEventLog: Record<string, unknown> }).ElectionEventLog;
  const devices = log.Device as Array<Record<string, unknown>>;
  return {
    "@type": "EventLogging.ElectionEventLog",
    ...log,
    Device: devices.map((device) => ({
      "@type": "EventLogging.Device",
      ...device,
      Event: (device.Event as Array<Record<string, unknown>>).map((event) => ({
        "@type": "EventLogging.Event",
        ...event,
        Sequence: String(event.Sequence),
      })),
    })),
  };
}

describe("fixtures map onto the vendored schemas", () => {
  test("every fixture file is listed exactly once, and every vendored schema is used", () => {
    expect(dataFiles(FIXTURE_DIR)).toEqual(FIXTURES.map((f) => f.file).sort());
    expect([...validators.keys()].sort()).toEqual([...new Set(FIXTURES.map((f) => f.schema))].sort());
  });

  test("the format modules on epic/4 are covered: two NIST formats, two simulator-private files", () => {
    const source = readFileSync(join(FIXTURE_DIR, "SOURCE.md"), "utf8");
    const modules = [...FIXTURES.map((f) => f.formatModule), ...Object.keys(NOT_NIST_FORMATS)];
    expect(new Set(modules).size).toBe(modules.length);
    for (const module of modules) expect(source).toContain(`\`${module}\``);
    expect(source).toContain("ca87bd3a7a26d2f0be84b6015b1e1804e16520bf");
  });

  test("each vendored schema's SHA-256 matches schemas/nist/SOURCES.md", () => {
    const recorded = sourceHashes(readFileSync(join(SCHEMA_DIR, "SOURCES.md"), "utf8"));
    expect([...recorded.keys()].sort()).toEqual([...validators.keys()].sort());
    for (const [file, hash] of recorded) expect(sha256File(join(SCHEMA_DIR, file)), file).toBe(hash);
  });

  test("each fixture's SHA-256 matches fixtures/simulator/SOURCE.md (copied, never edited)", () => {
    const recorded = sourceHashes(readFileSync(join(FIXTURE_DIR, "SOURCE.md"), "utf8"));
    for (const { file } of FIXTURES) expect(sha256File(join(FIXTURE_DIR, file)), file).toBe(recorded.get(file));
  });
});

describe.each(FIXTURES.filter((f) => f.status === "conforms"))("$standard: $file", (fixture) => {
  const value = readJson(join(FIXTURE_DIR, fixture.file));
  const validate = validatorFor(fixture.schema);

  test(`validates against ${fixture.schema}`, () => {
    expect(validate(value)).toEqual([]);
  });

  test(`fails without its required ${fixture.requiredPath.join(".")}`, () => {
    expect(validate(without(value, fixture.requiredPath))).not.toEqual([]);
  });

  test("fails with an unknown property (the schema is closed)", () => {
    expect(validate({ ...(value as object), VoterName: "x" })).not.toEqual([]);
  });
});

describe("NIST SP 1500-101: the simulator's machine log (known gap, see SOURCE.md)", () => {
  const fixture = FIXTURES.find((f) => f.status === "known-gap" && f.schema === EVENT_LOG_SCHEMA)!;
  const value = readJson(join(FIXTURE_DIR, fixture.file));
  const validate = validatorFor(EVENT_LOG_SCHEMA);

  test("the VotingWorks-shaped log does not validate as written; if this fails, mark it conforming", () => {
    expect(validate(value)).not.toEqual([]);
  });

  test("it validates once unwrapped, typed and given string sequences: those are the only differences", () => {
    expect(validate(toNistEventLog(value))).toEqual([]);
  });

  test(`the 1500-101 validator rejects a log without ${fixture.requiredPath.join(".")}`, () => {
    expect(validate(without(toNistEventLog(value), fixture.requiredPath))).not.toEqual([]);
  });

  test("the 1500-101 validator rejects an event without its required Sequence", () => {
    const log = toNistEventLog(value) as { Device: Array<{ Event: Array<Record<string, unknown>> }> };
    delete log.Device[0]!.Event[0]!.Sequence;
    expect(validate(log)).not.toEqual([]);
  });
});

describe("no voter identity in any fixture", () => {
  test("the key check flags VoterName and DateOfBirth but allows a candidate's Name", () => {
    const keys = objectKeys({ "@type": "CVR.Candidate", Name: "A", Voter: [{ VoterName: "x", DateOfBirth: "y" }] });
    const flagged = keys.filter(({ key, type }) => isIdentityName(key) && !(key === "Name" && NAME_KEY_TYPES.has(type)));
    expect(flagged.map((k) => k.key)).toEqual(["Voter", "VoterName", "DateOfBirth"]);
  });

  test.each(FIXTURES.map((f) => f.file))("%s has no identity key", (file) => {
    const keys = objectKeys(readJson(join(FIXTURE_DIR, file)));
    expect(keys.length).toBeGreaterThan(0);
    const flagged = keys.filter(({ key, type }) => isIdentityName(key) && !(key === "Name" && NAME_KEY_TYPES.has(type)));
    expect(flagged).toEqual([]);
  });
});

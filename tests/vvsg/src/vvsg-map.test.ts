// docs/vvsg-map.md is the evidence the judges see (T-14), so it must stay true: the right wording, one
// row per VVSG 2.0 area in the ticket, real paths, every VVSG test listed, and an unlocking ticket for
// everything not yet tested.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO = join(import.meta.dirname, "..", "..", "..");
const MAP_PATH = join(REPO, "docs", "vvsg-map.md");
const map = readFileSync(MAP_PATH, "utf8");

const AREAS = [
  "Software independence",
  "Ballot secrecy",
  "Interoperability",
  "Air gap / one-way flow",
  "Auditability and logging",
  "MFA and access control",
  "Accessibility and language access",
  "Penetration testing",
];
const STATUSES = new Set(["tested", "partly tested", "not yet tested"]);
const PRIORITIES = new Set(["Must", "Should", "Cut first"]);

type Row = { area: string; principle: string; priority: string; status: string; tests: string; unlockedBy: string };

/** The map table's data rows (the table whose header starts with "VVSG 2.0 area"). */
function mapRows(markdown: string): Row[] {
  const lines = markdown.split("\n");
  const header = lines.findIndex((line) => /^\|\s*VVSG 2\.0 area\s*\|/.test(line));
  if (header === -1) return [];
  const rows: Row[] = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.slice(1, line.endsWith("|") ? -1 : undefined).split("|").map((cell) => cell.trim());
    const [area = "", principle = "", priority = "", status = "", tests = "", unlockedBy = ""] = cells;
    rows.push({ area, principle, priority, status, tests, unlockedBy });
  }
  return rows;
}

/** Backtick spans that are repo paths. */
function citedPaths(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`\s]+)`/g)]
    .map((m) => m[1]!)
    .filter((span) => /^(?:apps|packages|supabase|tests|tools|docs|scripts)\/[\w./-]+$/.test(span));
}

/**
 * "certif..." (any case) within 60 characters of VVSG or EAC (upper case, so "each" or "reach" never
 * count), in either order. The CERTIFIED ballot status on its own is fine.
 */
const CERTIF = "[Cc][Ee][Rr][Tt][Ii][Ff]";
const CERTIFIED_CLAIM = new RegExp(`${CERTIF}[\\s\\S]{0,60}?\\b(?:VVSG|EAC)\\b|\\b(?:VVSG|EAC)\\b[\\s\\S]{0,60}?${CERTIF}`);
const claimsCertification = (text: string) => CERTIFIED_CLAIM.test(text);

function textFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" || name === ".next" ? [] : textFiles(path);
    return /\.(?:md|mdx|txt|ts|tsx|js|jsx|mjs|json|css|html)$/.test(name) ? [path] : [];
  });
}

const rows = mapRows(map);

describe("docs/vvsg-map.md", () => {
  test('says "built to align with VVSG 2.0"', () => {
    expect(map).toContain("built to align with VVSG 2.0");
  });

  test("has one row for each of the ticket's 8 areas, each with a priority and an allowed status", () => {
    expect(rows.map((r) => r.area)).toEqual(AREAS);
    for (const row of rows) {
      expect(PRIORITIES.has(row.priority), `${row.area} priority ${row.priority}`).toBe(true);
      expect(STATUSES.has(row.status), `${row.area} status ${row.status}`).toBe(true);
      expect(row.principle, `${row.area} principle`).toMatch(/^\d+ /);
    }
  });

  test("the Must rows are the ticket's four Must areas", () => {
    const must = rows.filter((r) => r.priority === "Must");
    expect(must.map((r) => r.area)).toEqual(AREAS.slice(0, 4));
  });

  test("every cited repo path exists", () => {
    const paths = citedPaths(map);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((path) => !existsSync(join(REPO, path)))).toEqual([]);
  });

  test("every tested or partly tested row cites a test file", () => {
    for (const row of rows.filter((r) => r.status !== "not yet tested")) {
      expect(citedPaths(row.tests).some((p) => p.endsWith(".test.ts")), row.area).toBe(true);
    }
  });

  test("every VVSG test file is cited", () => {
    const tests = readdirSync(import.meta.dirname)
      .filter((name) => name.endsWith(".test.ts"))
      .map((name) => `tests/vvsg/src/${name}`);
    expect(tests.length).toBeGreaterThanOrEqual(4);
    const cited = new Set(citedPaths(map));
    expect(tests.filter((path) => !cited.has(path))).toEqual([]);
  });

  test("every row not fully tested names its ticket, or the locked-interface or .github/ change it needs", () => {
    for (const row of rows.filter((r) => r.status !== "tested")) {
      expect(row.unlockedBy, row.area).toMatch(/\bT-\d{2} #\d+\b|locked-interface change|`\.github\/` change/);
    }
  });
});

describe("wording: built to align with VVSG 2.0, never certified", () => {
  test.each([
    ["VVSG 2.0 certified", true],
    ["Certified by the EAC", true],
    ["certification\nunder VVSG", true],
    ["built to align with VVSG 2.0", false],
    ["each ballot is CERTIFIED", false],
    ["The certified totals reach each county", false],
  ])("the check on %j gives %s", (text, expected) => {
    expect(claimsCertification(text)).toBe(expected);
  });

  test("no file under docs/ or apps/web/app/ claims VVSG or EAC certification", () => {
    const files = [...textFiles(join(REPO, "docs")), ...textFiles(join(REPO, "apps", "web", "app"))];
    expect(files).toContain(MAP_PATH);
    const offenders = files.filter((file) => claimsCertification(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});

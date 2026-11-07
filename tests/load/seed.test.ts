// Ties the hard-coded test data in config.ts to supabase/seed.sql, so a seed change can't silently leave the
// load test requesting codes or precincts that don't exist. Pure: reads the SQL file as text, no database.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULTS, SEED_CODES } from "./config.ts";

const seed = readFileSync(new URL("../../supabase/seed.sql", import.meta.url), "utf8")
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

/**
 * The whole statement (CTE included) that inserts into a table. Fails the test if the seed has none or several.
 * Splitting on `;` is safe here: the seed has no semicolons inside string literals.
 */
function insertStatement(table: string): string {
  const pattern = new RegExp(`\\binsert\\s+into\\s+${table.replace(".", "\\.")}\\b`, "i");
  const matches = seed.split(";").filter((statement) => pattern.test(statement));
  expect(matches, `exactly one insert into ${table} in supabase/seed.sql`).toHaveLength(1);
  return matches[0] as string;
}

/** First column of each row in an `insert ... values (...), (...);` statement. */
function firstColumnValues(statement: string): string[] {
  const values = statement.slice(statement.search(/\bvalues\b/i));
  return [...values.matchAll(/\(\s*'([^']*)'/g)].map((m) => m[1] as string);
}

/**
 * Tracking codes the ballots insert produces. The seed generates them with
 * `'<prefix>' || lpad(n::text, <width>, '0')` over `generate_series(<from>, <to>) as n`; any literal codes
 * in the statement are included too, so a hand-written row can't slip past.
 */
function seededTrackingCodes(): string[] {
  const statement = insertStatement("private.ballots");
  const codes: string[] = [];

  const series = [...statement.matchAll(/generate_series\(\s*(\d+)\s*,\s*(\d+)\s*\)\s+as\s+n\b/gi)];
  const formats = [...statement.matchAll(/'([^']*)'\s*\|\|\s*lpad\(\s*n::text\s*,\s*(\d+)\s*,\s*'0'\s*\)/gi)];
  if (series.length > 0 || formats.length > 0) {
    expect(series, "one generate_series in the ballots insert").toHaveLength(1);
    expect(formats, "one tracking-code format over n in the ballots insert").toHaveLength(1);
    const [, from, to] = series[0] as RegExpMatchArray;
    const [, prefix, width] = formats[0] as RegExpMatchArray;
    for (let n = Number(from); n <= Number(to); n++) codes.push(`${prefix}${String(n).padStart(Number(width), "0")}`);
  }

  for (const m of statement.matchAll(/'(SEED-\d+)'/g)) codes.push(m[1] as string);
  return codes;
}

const sorted = (values: readonly string[]) => [...values].sort();

describe("config.ts matches supabase/seed.sql", () => {
  it("SEED_CODES are exactly the seeded tracking codes", () => {
    const seeded = seededTrackingCodes();
    expect(seeded.length).toBeGreaterThan(0);
    expect(new Set(seeded).size, "seeded tracking codes are unique").toBe(seeded.length);
    expect(new Set(SEED_CODES).size, "SEED_CODES are unique").toBe(SEED_CODES.length);
    expect(sorted(SEED_CODES)).toEqual(sorted(seeded));
  });

  it("DEFAULTS.recordScopes are exactly the seeded precincts", () => {
    const precincts = firstColumnValues(insertStatement("public.precincts"));
    expect(precincts.length).toBeGreaterThan(0);
    expect(new Set(DEFAULTS.recordScopes).size, "recordScopes are unique").toBe(DEFAULTS.recordScopes.length);
    expect(sorted(DEFAULTS.recordScopes)).toEqual(sorted(precincts));
  });
});

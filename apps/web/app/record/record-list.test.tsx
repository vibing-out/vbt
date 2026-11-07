import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { NO_RECORDS, RECORD_FORMAT_URL, RECORDS_UNAVAILABLE, VERIFIER_URL } from "../../lib/record/copy";
import { groupByCounty } from "../../lib/record/group";
import type { RecordSummary } from "../../lib/record/types";
import { type RecordListState, RecordListView } from "./record-list";

const record = (fields: Partial<RecordSummary> & Pick<RecordSummary, "scope_id" | "stage">): RecordSummary => ({
  scope: fields.stage === "TALLIED_PRECINCT" ? "precinct" : "county",
  merkle_root: "1".repeat(64),
  ballot_count: 3,
  totals: { mayor: { a: 2, b: 1 } },
  published_on: "2026-11-03",
  signature: "ab".repeat(64),
  ...fields,
});

const counties = groupByCounty([
  { countyId: "18097", record: record({ scope_id: "18097-001", stage: "TALLIED_PRECINCT" }) },
  { countyId: "18097", record: record({ scope_id: "18097", stage: "REPORTED_UNOFFICIAL", merkle_root: "2".repeat(64), ballot_count: 1 }) },
  { countyId: "18057", record: record({ scope_id: "18057-001", stage: "TALLIED_PRECINCT", totals: {} }) },
]);

const render = (state: RecordListState) => renderToStaticMarkup(<RecordListView state={state} />);
const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("AC2: lists every record by county and stage with its download, Merkle root, totals and signature", () => {
  const html = render({ kind: "ready", counties });
  const page = text(html);
  // Counties in id order, each with its records in stage order.
  expect(page.indexOf("County 18057")).toBeLessThan(page.indexOf("County 18097"));
  expect(page.indexOf("Precinct 18097-001")).toBeLessThan(page.indexOf("County 18097 · 1 ballot"));
  expect(html.match(/data-testid="record-entry"/g)).toHaveLength(3);

  for (const [scopeId, stage] of [
    ["18097-001", "TALLIED_PRECINCT"],
    ["18097", "REPORTED_UNOFFICIAL"],
    ["18057-001", "TALLIED_PRECINCT"],
  ]) {
    expect(html).toContain(`id="record-${scopeId}-${stage}"`);
    expect(html).toContain(`href="/api/record/${scopeId}/${stage}" download="${scopeId}-${stage}.json"`);
  }
  expect(page).toContain("Counted at precinct");
  expect(page).toContain("Included in election-night results");
  expect(page).toContain("1".repeat(64));
  expect(page).toContain("2".repeat(64));
  expect(page).toContain("ab".repeat(64));
  expect(page).toContain("mayor a 2");
  expect(page).toContain("No totals in this record.");
  expect(page).toContain("Published November 3, 2026");
});

test("AC3: a Check it yourself section links the record format and the verifier", () => {
  const states: RecordListState[] = [{ kind: "ready", counties }, { kind: "ready", counties: [] }, { kind: "unavailable" }];
  for (const state of states) {
    const html = render(state);
    expect(text(html)).toContain("Check it yourself");
    expect(html).toContain(`href="${RECORD_FORMAT_URL}"`);
    expect(html).toContain(`href="${VERIFIER_URL}"`);
  }
  expect(RECORD_FORMAT_URL).toMatch(/\/docs\/record-format\.md$/);
  expect(VERIFIER_URL).toMatch(/\/tools\/verifier$/);
});

test("empty and unavailable states", () => {
  expect(text(render({ kind: "ready", counties: [] }))).toContain(NO_RECORDS);
  expect(text(render({ kind: "unavailable" }))).toContain(RECORDS_UNAVAILABLE);
});

test("AC5: dates only, never a time of day", () => {
  const page = text(render({ kind: "ready", counties }));
  expect(page).not.toMatch(/\d{1,2}:\d{2}/);
  expect(page).not.toMatch(/\b(AM|PM)\b/);
});

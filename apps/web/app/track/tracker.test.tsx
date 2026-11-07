import { BALLOT_STATUSES, type BallotStatus, publicLabel } from "@vbt/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { CHECK_TEXT, detailLine, NOT_FOUND_MESSAGE, RECEIPT_FOOTER, REFRESH_FAILED } from "../../lib/track/copy";
import type { CheckState, TrackResult, TrackStage } from "../../lib/track/types";
import { TrackerView } from "./tracker";

const precinct = { id: "18097-001", name: "Center 1", countyId: "18097" };

const stage = (s: BallotStatus, state: CheckState): TrackStage => ({
  stage: s,
  scope: s === "TALLIED_PRECINCT" ? "precinct" : "county",
  scopeId: s === "TALLIED_PRECINCT" ? "18097-001" : "18097",
  merkleRoot: "root",
  signature: "sig",
  publishedOn: "2026-11-04",
  recordUrl: null,
  check: { state, proof: null },
});

function ballot(path: BallotStatus[], reasons: Partial<Record<BallotStatus, string>> = {}, checks: CheckState = "unavailable"): TrackResult {
  const status = path.at(-1)!;
  return {
    trackingCode: "SEED-0001",
    status,
    label: publicLabel(status),
    terminal: ["CERTIFIED", "DISCARDED", "SPOILED"].includes(status),
    ciphertextHash: "ab12cd34",
    castDate: "2026-11-03",
    precinct,
    timeline: path.map((s) => ({ status: s, label: publicLabel(s), date: "2026-11-03", reason: reasons[s] ?? null })),
    stages: path
      .filter((s) => ["TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED"].includes(s))
      .map((s) => stage(s, checks)),
  };
}

const PATHS: Record<BallotStatus, BallotStatus[]> = {
  CAST: ["CAST"],
  TALLIED_PRECINCT: ["CAST", "TALLIED_PRECINCT"],
  REPORTED_UNOFFICIAL: ["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL"],
  CERTIFIED: ["CAST", "TALLIED_PRECINCT", "REPORTED_UNOFFICIAL", "CERTIFIED"],
  CHALLENGED: ["CAST", "TALLIED_PRECINCT", "CHALLENGED"],
  DISCARDED: ["CAST", "TALLIED_PRECINCT", "CHALLENGED", "DISCARDED"],
  SPOILED: ["CAST", "SPOILED"],
};

const render = (data: TrackResult, stale = false) =>
  renderToStaticMarkup(<TrackerView code={data.trackingCode} state={{ kind: "ready", data, stale }} />);
// Text content only, with entities decoded the way a reader sees them.
const text = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("AC5: stages and wording follow the voter journey", () => {
  test.each(BALLOT_STATUSES)("%s shows publicLabel and its detail line", (status) => {
    const page = text(render(ballot(PATHS[status], { CHALLENGED: "Mismatch with paper ballot", DISCARDED: "Provisional ballot rejected" })));
    expect(page).toContain(publicLabel(status));
    expect(page).toContain(detailLine(status, { precinct }).replace(/'/g, "'"));
    expect(page).toContain(`Current status: ${publicLabel(status)}`);
  });

  test("the detail lines name the precinct and county, as the voter journey does", () => {
    expect(detailLine("TALLIED_PRECINCT", { precinct })).toBe("Counted at Center 1.");
    expect(detailLine("REPORTED_UNOFFICIAL", { precinct })).toBe("Included in county 18097's election-night results.");
    expect(detailLine("CAST", { precinct })).toContain("encrypted ballot recorded");
  });

  test("CHALLENGED and DISCARDED show the reason", () => {
    const page = text(render(ballot(PATHS.DISCARDED, { CHALLENGED: "Mismatch with paper ballot", DISCARDED: "Provisional ballot rejected" })));
    expect(page).toContain("Reason: Mismatch with paper ballot");
    expect(page).toContain("Reason: Provisional ballot rejected");
  });

  test("a stage reached again after an accepted review says so", () => {
    const page = text(render(ballot(["CAST", "TALLIED_PRECINCT", "CHALLENGED", "TALLIED_PRECINCT"])));
    expect(page).toContain("Review finished");
  });

  test("dates read as calendar dates, with the receipt footer and the ciphertext hash line", () => {
    const page = text(render(ballot(PATHS.TALLIED_PRECINCT)));
    expect(page).toContain("November 3, 2026");
    expect(page).toContain("Encrypted ballot recorded: ab12cd34");
    expect(page).toContain(RECEIPT_FOOTER);
    expect(page).toContain("Track another code");
  });
});

describe("integrity check lines", () => {
  test("AC1: passing checks show 'Unchanged and included' for every published stage", () => {
    const html = render(ballot(PATHS.CERTIFIED, {}, "passed"));
    expect(html.match(new RegExp(CHECK_TEXT.passed.replace(/'/g, "&#x27;"), "g"))?.length).toBe(3);
  });

  test("AC11: an unavailable check says 'Check not yet available' and never claims a pass", () => {
    const html = render(ballot(PATHS.CERTIFIED, {}, "unavailable"));
    expect(html.match(/Check not yet available/g)?.length).toBe(3);
    expect(html).not.toMatch(/Unchanged and included|passed|✓/);
  });

  test("a failed check says so", () => {
    expect(text(render(ballot(PATHS.TALLIED_PRECINCT, {}, "failed")))).toContain(CHECK_TEXT.failed);
  });

  test("the record link shows only when a recordUrl exists", () => {
    const data = ballot(PATHS.TALLIED_PRECINCT);
    expect(render(data)).not.toContain("View the published record");
    data.stages[0]!.recordUrl = "/api/record/precinct/TALLIED_PRECINCT";
    expect(render(data)).toContain('href="/api/record/precinct/TALLIED_PRECINCT"');
  });

  test("T-08b AC1: each published stage links to its record on /record", () => {
    const data = ballot(PATHS.CERTIFIED);
    for (const s of data.stages) s.recordUrl = `/record#record-${s.scopeId}-${s.stage}`;
    const html = render(data);
    for (const href of [
      "/record#record-18097-001-TALLIED_PRECINCT",
      "/record#record-18097-REPORTED_UNOFFICIAL",
      "/record#record-18097-CERTIFIED",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html.match(/View the published record/g)).toHaveLength(3);
  });
});

test("AC4: the page never shows a time of day", () => {
  const page = text(render(ballot(PATHS.DISCARDED, { DISCARDED: "Provisional ballot rejected" }, "passed")));
  expect(page).not.toMatch(/\d{1,2}:\d{2}/);
  expect(page).not.toMatch(/T\d{2}:\d{2}/);
});

test("AC2: not found shows only the generic message", () => {
  const page = text(renderToStaticMarkup(<TrackerView code="SEED-9999" state={{ kind: "not_found" }} />));
  expect(page).toContain(NOT_FOUND_MESSAGE);
  expect(page).not.toMatch(/Cast and sealed|Current status/);
});

test("a failed refresh keeps the last data and says it is retrying", () => {
  const page = text(render(ballot(PATHS.TALLIED_PRECINCT), true));
  expect(page).toContain(REFRESH_FAILED);
  expect(page).toContain("Counted at Center 1.");
});

test("the status region is announced politely to screen readers", () => {
  expect(render(ballot(PATHS.CAST))).toMatch(/<p aria-live="polite"[^>]*>Current status: Cast and sealed/);
});

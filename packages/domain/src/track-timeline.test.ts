import { expect, test } from "vitest";
import { buildTrackTimeline, publicReason, type PublicEvent, sortStageRecords, stageOrder } from "./index.ts";

const cast: PublicEvent = {
  event_type: "CAST",
  from_status: null,
  to_status: "CAST",
  reason: null,
  occurred_on: "2026-11-03",
  prev_hash: null,
  hash: "a1",
};

const step = (
  hash: string,
  prev: string,
  to: string,
  extra: Partial<PublicEvent> = {},
): PublicEvent => ({
  event_type: "STATUS_CHANGE",
  from_status: null,
  to_status: to,
  reason: null,
  occurred_on: "2026-11-04",
  prev_hash: prev,
  hash,
  ...extra,
});

test("the timeline starts with CAST and follows the chain, not row order", () => {
  const rows = [
    step("0a", "9f", "REPORTED_UNOFFICIAL"),
    step("5c", "a1", "TALLIED_PRECINCT"),
    step("9f", "5c", "CHALLENGED", { reason: "  signature mismatch  " }),
  ];
  const timeline = buildTrackTimeline(rows.concat(cast), "2026-11-03");
  expect(timeline.map((e) => e.status)).toEqual(["CAST", "TALLIED_PRECINCT", "CHALLENGED", "REPORTED_UNOFFICIAL"]);
  expect(timeline[0]).toEqual({ status: "CAST", label: expect.any(String), date: "2026-11-03", reason: null });
});

test("CAST takes the event date when the cast date is unknown", () => {
  expect(buildTrackTimeline([cast], null)[0]!.date).toBe("2026-11-03");
});

test("CAST has no date when neither the cast date nor a CAST event is known", () => {
  expect(buildTrackTimeline([], null)).toEqual([{ status: "CAST", label: expect.any(String), date: null, reason: null }]);
});

test("a time of day is never shown as a date", () => {
  const timeline = buildTrackTimeline([cast, step("5c", "a1", "TALLIED_PRECINCT", { occurred_on: "2026-11-04T09:30:00Z" })], "2026-11-03");
  expect(timeline[1]!.date).toBeNull();
});

test("a MISMATCH_DETECTED flag with no status adds no entry", () => {
  const flag = step("5c", "a1", "", { event_type: "MISMATCH_DETECTED", to_status: null });
  expect(buildTrackTimeline([cast, flag], "2026-11-03")).toHaveLength(1);
});

test("only a challenge or a discard discloses its reason", () => {
  expect(publicReason("CHALLENGED", "  tally error  ")).toBe("tally error");
  expect(publicReason("DISCARDED", "duplicate")).toBe("duplicate");
  expect(publicReason("CHALLENGED", "   ")).toBeNull();
  expect(publicReason("CHALLENGED", null)).toBeNull();
  expect(publicReason("TALLIED_PRECINCT", "internal note")).toBeNull();
  expect(publicReason("CERTIFIED", "internal note")).toBeNull();
});

test("the timeline discloses a reason only for challenged and discarded entries", () => {
  const rows = [cast, step("5c", "a1", "CHALLENGED", { reason: "recount" }), step("9f", "5c", "TALLIED_PRECINCT", { reason: "leak" })];
  const timeline = buildTrackTimeline(rows, "2026-11-03");
  expect(timeline.map((e) => e.reason)).toEqual([null, "recount", null]);
});

test("stage order follows the published list; unpublished stages sort last", () => {
  expect(stageOrder("TALLIED_PRECINCT")).toBeLessThan(stageOrder("CERTIFIED"));
  expect(stageOrder("CAST")).toBe(99);
});

test("stage records sort by stage, then publication date, and are not mutated", () => {
  const input = [
    { stage: "CERTIFIED" as const, publishedOn: "2026-11-05" },
    { stage: "TALLIED_PRECINCT" as const, publishedOn: "2026-11-06" },
    { stage: "TALLIED_PRECINCT" as const, publishedOn: "2026-11-04" },
    { stage: "TALLIED_PRECINCT" as const, publishedOn: null },
    { stage: "TALLIED_PRECINCT" as const, publishedOn: null },
  ];
  const sorted = sortStageRecords(input);
  expect(sorted.map((r) => [r.stage, r.publishedOn])).toEqual([
    ["TALLIED_PRECINCT", null],
    ["TALLIED_PRECINCT", null],
    ["TALLIED_PRECINCT", "2026-11-04"],
    ["TALLIED_PRECINCT", "2026-11-06"],
    ["CERTIFIED", "2026-11-05"],
  ]);
  expect(input[0]!.stage).toBe("CERTIFIED");
});

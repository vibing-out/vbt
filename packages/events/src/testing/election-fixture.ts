// Test fixture: a small two-county election written as the files officials upload (NIST SP 1500-101
// machine logs in JSON and XML, NIST SP 1500-100 V2 results) plus the ElectionGuard record (ballots and
// decrypted precinct tallies). Each fault is injected into the files the way a faulty source would
// write them, standing in for the simulator's fault injection (T-06), which a follow-up ticket wires up.
// Test-only: nothing in src/ imports this.

import { type BallotStatus, type PrecinctTally, type RecordedBallot, type RecordedResolution, type Totals, sumTotals } from "@vbt/domain";
import { CDF_LOG_NAMESPACE } from "../cdf-log-xml.ts";

type Json = Record<string, unknown>;

/** county -> precinct -> machines. 18097 breaks its election-night report down by precinct; 18003 does not. */
export const COUNTIES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  "18097": { "18097-001": ["M-001-A", "M-001-B"], "18097-002": ["M-002-A"] },
  "18003": { "18003-001": ["M-003-A"] },
};
const BROKEN_DOWN = new Set(["18097"]);

export const CONTESTS: Readonly<Record<string, readonly [string, string]>> = {
  mayor: ["ada", "bo"],
  "measure-1": ["yes", "no"],
};

export const FAULTS = [
  "machine-log-undercount",
  "precinct-report-altered",
  "enr-precinct-figure",
  "enr-county-total",
  "certified-unexplained",
  "certified-recorded-discard",
] as const;
export type Fault = (typeof FAULTS)[number];

export const FAULT_TARGET = {
  machine: "M-001-B",
  precinct: "18097-002",
  breakdownPrecinct: "18097-001",
  county: "18003",
  certifiedCounty: "18097",
} as const;

export type LogFile = { format: "json" | "xml"; text: string };

export type Fixture = {
  ballots: RecordedBallot[];
  precinctTallies: PrecinctTally[];
  resolutions: RecordedResolution[];
  /** Uploaded files, as text. */
  eventLogs: LogFile[];
  precinctReports: string[];
  electionNight: string[];
  certified: string[];
};

/** Ballots per machine, varied so no two machines match. Every seventh is spoiled. */
function buildBallots(): { ballots: RecordedBallot[]; votes: Map<string, Totals> } {
  const ballots: RecordedBallot[] = [];
  const votes = new Map<string, Totals>();
  let n = 0;
  for (const [countyId, precincts] of Object.entries(COUNTIES)) {
    for (const [precinctId, machines] of Object.entries(precincts)) {
      machines.forEach((machineId, m) => {
        const count = 5 + m * 3 + (precinctId.length % 4);
        for (let i = 0; i < count; i++) {
          n += 1;
          const id = `ballot-${String(n).padStart(3, "0")}`;
          const status: BallotStatus = n % 7 === 0 ? "SPOILED" : "CAST";
          ballots.push({ id, machineId, precinctId, countyId, status });
          if (status === "SPOILED") continue;
          votes.set(id, {
            mayor: { [CONTESTS.mayor![n % 3 === 0 ? 1 : 0]!]: 1 },
            "measure-1": { [CONTESTS["measure-1"]![n % 2 === 0 ? 0 : 1]!]: 1 },
          });
        }
      });
    }
  }
  return { ballots, votes };
}

/** A 1500-101 ElectionEventLog in the JSON shape. */
function eventLog(machineIds: readonly string[], ballots: readonly RecordedBallot[]): Json {
  const event = (Id: string, seq: number, Disposition = "success") => ({
    "@type": "EventLogging.Event",
    Id,
    Disposition,
    Sequence: String(seq),
    TimeStamp: `2026-11-03T${String(6 + Math.floor(seq / 60)).padStart(2, "0")}:${String(seq % 60).padStart(2, "0")}:00-05:00`,
    Type: "user-action",
  });
  return {
    "@type": "EventLogging.ElectionEventLog",
    GeneratedTime: "2026-11-03T19:05:00-05:00",
    Device: machineIds.map((machineId) => {
      const cast = ballots.filter((b) => b.machineId === machineId);
      const events = [event("polls-opened", 1)];
      cast.forEach((b, i) => {
        // A spoiled ballot is logged (an unmapped id) but never counted.
        events.push(event(b.status === "SPOILED" ? "ballot-invalidated" : "vote-cast", i + 2));
      });
      events.push(event("unknown-error", cast.length + 2, "failure"));
      events.push(event("polls-closed", cast.length + 3));
      return { "@type": "EventLogging.Device", Id: machineId, Type: "bmd", Manufacturer: "VBT", Model: "sim", Event: events };
    }),
  };
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The same log as 1500-101 XML: every field a child element, in the NIST namespace. */
export function toXml(log: Json): string {
  const element = (name: string, value: unknown): string => {
    if (Array.isArray(value)) return value.map((v) => element(name, v)).join("");
    if (typeof value === "object" && value !== null) {
      const children = Object.entries(value as Json)
        .filter(([k]) => k !== "@type")
        .map(([k, v]) => element(k, v))
        .join("");
      return `<cdf:${name}>${children}</cdf:${name}>`;
    }
    return `<cdf:${name}>${escapeXml(String(value))}</cdf:${name}>`;
  };
  const body = element("ElectionEventLog", log).replace("<cdf:ElectionEventLog>", `<cdf:ElectionEventLog xmlns:cdf="${CDF_LOG_NAMESPACE}">`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}

const ref = (id: string) => `gpu-${id}`;

function gpUnit(type: "precinct" | "county", localId: string, composing: string[] = []): Json {
  return {
    "@id": ref(localId),
    "@type": "ElectionResults.ReportingUnit",
    Type: type,
    ...(composing.length ? { ComposingGpUnitIds: composing.map(ref) } : {}),
    ExternalIdentifier: [{ "@type": "ElectionResults.ExternalIdentifier", Type: "local-level", Value: localId }],
  };
}

type Figures = { id: string; totals: Totals; ballotCount?: number };

/**
 * One 1500-100 V2 ElectionReport. `county` carries the county unit (always present, so every precinct
 * has a county); its figures are written only when given. Every unit gets a `total` VoteCounts plus an
 * election-day breakdown the importer must ignore.
 */
function electionReport(status: "unofficial-complete" | "certified", countyId: string, county: Figures | null, precincts: Figures[]): Json {
  const withCounts = [...(county ? [county] : []), ...precincts];
  return {
    "@type": "ElectionResults.ElectionReport",
    Format: precincts.length ? "precinct-level" : "summary-contest",
    GeneratedDate: "2026-11-03T22:00:00-05:00",
    Issuer: `County ${countyId}`,
    IssuerAbbreviation: countyId,
    SequenceStart: 1,
    SequenceEnd: 1,
    Status: status,
    VendorApplicationId: "vbt-fixture",
    GpUnit: [gpUnit("county", countyId, precincts.map((p) => p.id)), ...precincts.map((p) => gpUnit("precinct", p.id))],
    Election: [
      {
        "@type": "ElectionResults.Election",
        BallotCounts: withCounts
          .filter((u) => u.ballotCount !== undefined)
          .map((u) => ({ "@type": "ElectionResults.BallotCounts", GpUnitId: ref(u.id), Type: "total", BallotsCast: u.ballotCount })),
        Contest: Object.entries(CONTESTS).map(([contestId, selections]) => ({
          "@id": contestId,
          "@type": "ElectionResults.BallotMeasureContest",
          ContestSelection: selections.map((selectionId) => ({
            "@id": selectionId,
            "@type": "ElectionResults.BallotMeasureSelection",
            VoteCounts: withCounts.flatMap((u) => [
              { "@type": "ElectionResults.VoteCounts", GpUnitId: ref(u.id), Type: "total", Count: u.totals[contestId]?.[selectionId] ?? 0 },
              { "@type": "ElectionResults.VoteCounts", GpUnitId: ref(u.id), Type: "election-day", Count: 999 },
            ]),
          })),
        })),
      },
    ],
  };
}

/** Moves one vote between two selections. */
function shift(totals: Totals, contestId: string, from: string, to: string): Totals {
  const contest = { ...totals[contestId] };
  contest[from] = (contest[from] ?? 0) - 1;
  contest[to] = (contest[to] ?? 0) + 1;
  return { ...totals, [contestId]: contest };
}

/** Builds the election, with at most one fault injected into one source's files. */
export function buildFixture(fault?: Fault): Fixture {
  const { ballots: built, votes } = buildBallots();
  const precinctIds = Object.values(COUNTIES).flatMap((p) => Object.keys(p));
  const tallyOf = (inScope: (b: RecordedBallot) => boolean) =>
    sumTotals(built.filter((b) => inScope(b) && votes.has(b.id)).map((b) => votes.get(b.id)!));
  const precinctTallies = precinctIds.map((precinctId) => ({ precinctId, totals: tallyOf((b) => b.precinctId === precinctId) }));

  // Positive control: one ballot in the certified county is discarded after election night, recorded.
  const discarded =
    fault === "certified-recorded-discard" ? built.find((b) => b.countyId === FAULT_TARGET.certifiedCounty && b.status === "CAST")! : undefined;
  const ballots = built.map((b) => (b.id === discarded?.id ? { ...b, status: "DISCARDED" as const } : b));

  // Machine logs: one file per precinct, alternating JSON and XML.
  const eventLogs = Object.values(COUNTIES).flatMap((precincts) => Object.values(precincts)).map((machines, i): LogFile => {
    const log = eventLog(machines, ballots);
    if (fault === "machine-log-undercount" && machines.includes(FAULT_TARGET.machine)) {
      const device = (log.Device as Json[]).find((d) => d.Id === FAULT_TARGET.machine)!;
      const events = device.Event as Json[];
      events.splice(events.findIndex((e) => e.Id === "vote-cast"), 1);
    }
    return i % 2 === 0 ? { format: "json", text: JSON.stringify(log) } : { format: "xml", text: toXml(log) };
  });

  // What each precinct reported to the county; the county aggregates what it receives.
  const reported = new Map(precinctTallies.map((t) => [t.precinctId, t.totals]));
  if (fault === "precinct-report-altered") {
    reported.set(FAULT_TARGET.precinct, shift(reported.get(FAULT_TARGET.precinct)!, "mayor", "ada", "bo"));
  }

  const precinctReports: string[] = [];
  const electionNight: string[] = [];
  const certified: string[] = [];
  const resolutions: RecordedResolution[] = [];
  for (const [countyId, precincts] of Object.entries(COUNTIES)) {
    const ids = Object.keys(precincts);
    for (const id of ids) {
      precinctReports.push(JSON.stringify(electionReport("unofficial-complete", countyId, null, [{ id, totals: reported.get(id)! }])));
    }

    const cast = ballots.filter((b) => b.countyId === countyId && b.status !== "SPOILED").length;
    let night = sumTotals(ids.map((id) => reported.get(id)!));
    if (fault === "enr-county-total" && countyId === FAULT_TARGET.county) night = shift(night, "measure-1", "yes", "no");
    const breakdown = BROKEN_DOWN.has(countyId)
      ? ids.map((id) => ({
          id,
          totals:
            fault === "enr-precinct-figure" && id === FAULT_TARGET.breakdownPrecinct
              ? shift(reported.get(id)!, "measure-1", "no", "yes")
              : reported.get(id)!,
        }))
      : [];
    electionNight.push(JSON.stringify(electionReport("unofficial-complete", countyId, { id: countyId, totals: night, ballotCount: cast }, breakdown)));

    // Certified follows the published election-night figures, less any recorded discard.
    let final = night;
    let finalCount = cast;
    if (discarded && countyId === discarded.countyId) {
      const removed = votes.get(discarded.id)!;
      final = sumTotals([night, sumTotals([removed], -1)]);
      finalCount -= 1;
      resolutions.push({ countyId, kind: "removed", ballotIds: [discarded.id], totals: removed });
    }
    if (fault === "certified-unexplained" && countyId === FAULT_TARGET.certifiedCounty) final = shift(final, "mayor", "bo", "ada");
    certified.push(JSON.stringify(electionReport("certified", countyId, { id: countyId, totals: final, ballotCount: finalCount }, [])));
  }

  return { ballots, precinctTallies, resolutions, eventLogs, precinctReports, electionNight, certified };
}

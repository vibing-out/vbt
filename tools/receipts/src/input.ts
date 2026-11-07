// The generator's input file: the election, its precincts, the election manifest (contests, choices and
// ballot styles) and one entry per ballot. Seeded ciphertexts are placeholders and this tool never
// decrypts anything, so a ballot's choices come only from this file.
//
// Unknown fields are rejected, so a time of casting or a voter's details can't ride along unnoticed.

import { parseCalendarDate } from "./dates.ts";

export interface Election {
  county_name: string; // e.g. "Marion County"
  name: string; // e.g. "General Election"
  date: string; // election day, YYYY-MM-DD
}

export interface Precinct {
  id: string;
  name: string;
}

export interface Selection {
  id: string;
  name: string;
}

export interface Contest {
  id: string;
  title: string;
  vote_for: number;
  selections: Selection[];
}

export interface BallotStyle {
  id: string;
  contest_ids: string[];
}

export interface Manifest {
  contests: Contest[];
  ballot_styles: BallotStyle[];
}

export interface BallotEntry {
  tracking_code: string;
  precinct_id: string;
  machine_id: string;
  ballot_style: string;
  cast_date: string; // YYYY-MM-DD
  /** contest id -> selected selection ids. A contest on the style that is missing here is an undervote. */
  choices: Record<string, string[]>;
}

export interface ReceiptsInput {
  version: 1;
  election: Election;
  precincts: Precinct[];
  manifest: Manifest;
  ballots: BallotEntry[];
}

/** Stored tracking codes are printed exactly as stored; this only refuses ones that can't print or link safely. */
const TRACKING_CODE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const MAX_TRACKING_CODE_LENGTH = 64;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function object(value: unknown, path: string, keys: readonly string[]): Json {
  if (!isObject(value)) throw new Error(`${path} must be an object`);
  const extra = Object.keys(value).filter((k) => !keys.includes(k));
  if (extra.length > 0) throw new Error(`${path} has unknown field(s): ${extra.join(", ")}`);
  for (const key of keys) {
    if (!(key in value)) throw new Error(`${path}.${key} is required`);
  }
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${path} must be a non-empty string`);
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function uniqueIds<T extends { id: string }>(items: T[], path: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) throw new Error(`${path} has duplicate id ${item.id}`);
    map.set(item.id, item);
  }
  return map;
}

/** Checks a tracking code is printable as-is and safe in a URL path. Never reformats it. */
export function assertTrackingCode(code: unknown, path = "tracking_code"): string {
  const value = text(code, path);
  if (value.length > MAX_TRACKING_CODE_LENGTH || !TRACKING_CODE.test(value)) {
    throw new Error(`${path} must be letters, digits and single hyphens (at most ${MAX_TRACKING_CODE_LENGTH})`);
  }
  return value;
}

function parseContest(value: unknown, path: string): Contest {
  const o = object(value, path, ["id", "title", "vote_for", "selections"]);
  const voteFor = o.vote_for;
  if (typeof voteFor !== "number" || !Number.isInteger(voteFor) || voteFor < 1) {
    throw new Error(`${path}.vote_for must be a positive integer`);
  }
  const selections = array(o.selections, `${path}.selections`).map((s, i) => {
    const so = object(s, `${path}.selections[${i}]`, ["id", "name"]);
    return { id: text(so.id, `${path}.selections[${i}].id`), name: text(so.name, `${path}.selections[${i}].name`) };
  });
  if (selections.length === 0) throw new Error(`${path}.selections must not be empty`);
  uniqueIds(selections, `${path}.selections`);
  return { id: text(o.id, `${path}.id`), title: text(o.title, `${path}.title`), vote_for: voteFor, selections };
}

/** Parses and validates the generator input. Throws with the path of the first problem. */
export function parseInput(raw: unknown): ReceiptsInput {
  const root = object(raw, "input", ["version", "election", "precincts", "manifest", "ballots"]);
  if (root.version !== 1) throw new Error("input.version must be 1");

  const e = object(root.election, "election", ["county_name", "name", "date"]);
  const election: Election = {
    county_name: text(e.county_name, "election.county_name"),
    name: text(e.name, "election.name"),
    date: text(e.date, "election.date"),
  };
  parseCalendarDate(election.date, "election.date");

  const precincts = array(root.precincts, "precincts").map((p, i) => {
    const po = object(p, `precincts[${i}]`, ["id", "name"]);
    return { id: text(po.id, `precincts[${i}].id`), name: text(po.name, `precincts[${i}].name`) };
  });
  const precinctById = uniqueIds(precincts, "precincts");

  const m = object(root.manifest, "manifest", ["contests", "ballot_styles"]);
  const contests = array(m.contests, "manifest.contests").map((c, i) => parseContest(c, `manifest.contests[${i}]`));
  const contestById = uniqueIds(contests, "manifest.contests");
  const ballotStyles = array(m.ballot_styles, "manifest.ballot_styles").map((s, i) => {
    const path = `manifest.ballot_styles[${i}]`;
    const so = object(s, path, ["id", "contest_ids"]);
    const contestIds = array(so.contest_ids, `${path}.contest_ids`).map((c, j) => text(c, `${path}.contest_ids[${j}]`));
    for (const id of contestIds) {
      if (!contestById.has(id)) throw new Error(`${path} lists unknown contest ${id}`);
    }
    if (new Set(contestIds).size !== contestIds.length) throw new Error(`${path} lists a contest twice`);
    return { id: text(so.id, `${path}.id`), contest_ids: contestIds };
  });
  const styleById = uniqueIds(ballotStyles, "manifest.ballot_styles");

  const seenCodes = new Set<string>();
  const ballots = array(root.ballots, "ballots").map((b, i): BallotEntry => {
    const path = `ballots[${i}]`;
    const bo = object(b, path, ["tracking_code", "precinct_id", "machine_id", "ballot_style", "cast_date", "choices"]);
    const trackingCode = assertTrackingCode(bo.tracking_code, `${path}.tracking_code`);
    if (seenCodes.has(trackingCode)) throw new Error(`${path}.tracking_code ${trackingCode} appears twice`);
    seenCodes.add(trackingCode);

    const precinctId = text(bo.precinct_id, `${path}.precinct_id`);
    if (!precinctById.has(precinctId)) throw new Error(`${path}.precinct_id ${precinctId} is not in precincts`);
    const styleId = text(bo.ballot_style, `${path}.ballot_style`);
    const style = styleById.get(styleId);
    if (!style) throw new Error(`${path}.ballot_style ${styleId} is not in manifest.ballot_styles`);
    const castDate = text(bo.cast_date, `${path}.cast_date`);
    parseCalendarDate(castDate, `${path}.cast_date`);

    if (!isObject(bo.choices)) throw new Error(`${path}.choices must be an object`);
    const choices: Record<string, string[]> = {};
    for (const [contestId, picked] of Object.entries(bo.choices)) {
      const cpath = `${path}.choices.${contestId}`;
      const contest = contestById.get(contestId);
      if (!contest || !style.contest_ids.includes(contestId)) {
        throw new Error(`${cpath}: contest is not on ballot style ${styleId}`);
      }
      const ids = array(picked, cpath).map((s, j) => text(s, `${cpath}[${j}]`));
      if (new Set(ids).size !== ids.length) throw new Error(`${cpath} selects the same choice twice`);
      if (ids.length > contest.vote_for) throw new Error(`${cpath} selects more than ${contest.vote_for}`);
      for (const id of ids) {
        if (!contest.selections.some((s) => s.id === id)) throw new Error(`${cpath}: unknown selection ${id}`);
      }
      choices[contestId] = ids;
    }

    return {
      tracking_code: trackingCode,
      precinct_id: precinctId,
      machine_id: text(bo.machine_id, `${path}.machine_id`),
      ballot_style: styleId,
      cast_date: castDate,
      choices,
    };
  });

  return { version: 1, election, precincts, manifest: { contests, ballot_styles: ballotStyles }, ballots };
}

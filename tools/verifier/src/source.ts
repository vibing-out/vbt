// Where the public record comes from, behind one interface: the public API
// (GET only, no auth) or a directory written by `vbt-verify download`. The
// verifier never calls a voting system, the database or the Data API, and
// never fetches the signing key from the server it is checking.
//
// Directory layout mirrors the URL paths:
//   <dir>/api/record/<scope_id>/<stage>.json   (missing file = not published)
//   <dir>/api/track/<TRACKING-CODE>.json

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  FormatError,
  parseRecord,
  parseTrack,
  type PublishedRecord,
  type PublishedTrack,
  SCOPE_ID,
  type Stage,
} from "./record.ts";

/** The part of fetch the verifier uses, so tests can inject one. */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

export const REQUEST_TIMEOUT_MS = 30_000;

/** Could not verify (exit 2). `line` is the whole `ERROR ...` output line. */
export class VerifyError extends Error {
  readonly line: string;
  constructor(where: string, reason: string) {
    super(reason);
    this.name = "VerifyError";
    this.line = `ERROR ${where}: ${reason}`;
  }
}

export const NOT_FOUND = Symbol("not found");

export type Fetched = { where: string; body: unknown | typeof NOT_FOUND };

export interface Source {
  /** Path segments under /api, such as ["record", "18097-001", "TALLIED_PRECINCT"]. */
  get(segments: readonly string[]): Promise<Fetched>;
}

function checkSegment(s: string): string {
  if (!SCOPE_ID.test(s)) throw new VerifyError(s, "not a valid scope id, stage or tracking code");
  return s;
}

/** https only, except http on localhost and 127.0.0.1 (tests). */
export function parseBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new VerifyError("--base-url", "must be an absolute URL, such as https://www.ballottrack.org");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new VerifyError("--base-url", "must use https (http only for localhost or 127.0.0.1)");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.search = "";
  url.hash = "";
  return url;
}

export function httpSource(base: URL, fetchFn: FetchLike): Source {
  return {
    async get(segments) {
      const url = new URL(`api/${segments.map((s) => encodeURIComponent(checkSegment(s))).join("/")}`, base).toString();
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await fetchFn(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        throw new VerifyError(url, timedOut ? "request timed out" : "network error");
      }
      if (res.status === 404) return { where: url, body: NOT_FOUND };
      if (!res.ok) throw new VerifyError(url, `HTTP ${res.status}`);
      try {
        return { where: url, body: await res.json() };
      } catch {
        return { where: url, body: undefined };
      }
    },
  };
}

export function dirSource(dir: string): Source {
  return {
    async get(segments) {
      const path = `${join(dir, "api", ...segments.map(checkSegment))}.json`;
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return { where: path, body: NOT_FOUND };
        throw new VerifyError(path, "could not read the file");
      }
      try {
        return { where: path, body: JSON.parse(text) };
      } catch {
        return { where: path, body: undefined };
      }
    },
  };
}

/** The stage record, or null when it is not published (404). Exit 2 on a malformed body. */
export async function getRecord(source: Source, scopeId: string, stage: Stage): Promise<{ where: string; record: PublishedRecord | null }> {
  const { where, body } = await source.get(["record", scopeId, stage]);
  if (body === NOT_FOUND) return { where, record: null };
  let record: PublishedRecord;
  try {
    record = parseRecord(body);
  } catch (err) {
    if (err instanceof FormatError) throw new VerifyError(where, `response is not a stage record (${err.message})`);
    throw err;
  }
  if (record.scope_id !== scopeId || record.stage !== stage) {
    throw new VerifyError(where, `response is not a stage record (it is for ${record.scope_id}/${record.stage})`);
  }
  return { where, record };
}

export async function getTrack(source: Source, code: string): Promise<PublishedTrack> {
  const { where, body } = await source.get(["track", code]);
  if (body === NOT_FOUND) throw new VerifyError(where, "no ballot has this tracking code");
  try {
    return parseTrack(body);
  } catch (err) {
    if (err instanceof FormatError) throw new VerifyError(where, `response is not a tracking record (${err.message})`);
    throw err;
  }
}

/** Saves each record that is published and well formed under `outDir`. Returns the records that were not published. */
export async function download(
  source: Source,
  outDir: string,
  wanted: readonly { scopeId: string; stage: Stage }[],
): Promise<{ saved: { scopeId: string; stage: Stage }[]; notPublished: { scopeId: string; stage: Stage }[] }> {
  const saved: { scopeId: string; stage: Stage }[] = [];
  const notPublished: { scopeId: string; stage: Stage }[] = [];
  for (const w of wanted) {
    const { record } = await getRecord(source, w.scopeId, w.stage);
    if (!record) {
      notPublished.push(w);
      continue;
    }
    const path = `${join(outDir, "api", "record", w.scopeId, w.stage)}.json`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(record)}\n`);
    saved.push(w);
  }
  return { saved, notPublished };
}

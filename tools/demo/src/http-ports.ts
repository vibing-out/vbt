// The ApiPort over HTTP: the locked endpoints (docs/locked-interfaces.md § API boundaries) at one origin,
// with the caller's own session forwarded, so each endpoint runs its own requireRole and records the same
// official as the actor as the manual flow does (ticket AC 4). No retries: a refused or failed call is an
// ApiError and the run stops.
//
// Request and response bodies beyond the locked "Returns" column are T-09's to define; the shapes below
// are this ticket's stubs (see the README) and are the one place to change when T-09 lands.

import { isBallotStatus } from "@vbt/domain";
import { ApiError, type ApiPort, type ExportFile, type Mismatch, type SetBallot, type TrackView } from "./ports.ts";
import { trimTrailingSlashes } from "./url.ts";

export interface HttpPortsOptions {
  /** The app's origin, e.g. https://www.ballottrack.org or the route's own origin. */
  readonly baseUrl: string;
  /** The official's session: `authorization` (Bearer) or `cookie`, forwarded to official endpoints only. */
  readonly session: Readonly<Record<string, string>>;
  /** VERCEL_AUTOMATION_BYPASS_SECRET, sent as x-vercel-protection-bypass only when set. */
  readonly bypassSecret?: string;
  /** NEXT_PUBLIC_SUPABASE_URL and the publishable key, to read the public view public.ballot_public. */
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly fetch?: typeof fetch;
}

const MAX_ERROR_TEXT = 300;

const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const text = (value: unknown, what: string): string => {
  if (typeof value !== "string" || value === "") throw new ApiError(502, `unexpected response: ${what} missing`);
  return value;
};

const status = (value: unknown) => {
  if (!isBallotStatus(value)) throw new ApiError(502, `unexpected response: status ${String(value)}`);
  return value;
};

export function httpPorts(options: HttpPortsOptions): ApiPort {
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = trimTrailingSlashes(options.baseUrl);
  const bypass: Record<string, string> = options.bypassSecret ? { "x-vercel-protection-bypass": options.bypassSecret } : {};

  const send = async (url: string, init: RequestInit & { headers?: Record<string, string> }): Promise<unknown> => {
    const response = await doFetch(url, { ...init, cache: "no-store", redirect: "error", headers: { ...bypass, ...init.headers } });
    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, MAX_ERROR_TEXT);
      throw new ApiError(response.status, `${init.method ?? "GET"} ${new URL(url).pathname} answered ${response.status}${body ? `: ${body}` : ""}`);
    }
    return response.json();
  };

  const official = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    send(`${base}${path}`, { ...init, headers: { ...options.session, ...init.headers } });

  const postJson = (path: string, body: unknown) =>
    official(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  return {
    async uploadEventsFile(file: ExportFile) {
      const form = new FormData();
      form.set("file", new Blob([file.body], { type: file.contentType }), file.name);
      const body = object(await official("/api/events", { method: "POST", body: form }));
      return { eventId: text(body.event_id ?? body.id, "event id") };
    },
    async createBatch(request) {
      const query = `?${request.scope}=${encodeURIComponent(request.scopeId)}`;
      const body = object(
        await postJson(`/api/batches${query}`, {
          scope: request.scope,
          scope_id: request.scopeId,
          from_status: request.from,
          to_status: request.to,
        }),
      );
      if (typeof body.count !== "number") throw new ApiError(502, "unexpected response: batch count missing");
      return { batchId: text(body.batch_id ?? body.id, "batch id"), count: body.count };
    },
    async listMismatches(countyId) {
      const raw = await official(`/api/reports/mismatches?county=${encodeURIComponent(countyId)}`);
      const list = Array.isArray(raw) ? raw : object(raw).mismatches;
      if (!Array.isArray(list)) throw new ApiError(502, "unexpected response: mismatch list missing");
      return list.map((item): Mismatch => {
        const m = object(item);
        return { challengeId: text(m.challenge_id, "challenge id"), trackingCode: text(m.tracking_code, "tracking code") };
      });
    },
    async resolveChallenge(challengeId, resolution) {
      const body = object(await postJson(`/api/challenges/${encodeURIComponent(challengeId)}/resolve`, resolution));
      return { status: status(body.status) };
    },
    async readTrack(code): Promise<TrackView> {
      // Public endpoint: the official's session is never sent to it.
      const body = object(await send(`${base}/api/track/${encodeURIComponent(code)}`, {}));
      return { status: status(body.status), reason: typeof body.reason === "string" ? body.reason : null };
    },
    async readSet(precinctId): Promise<SetBallot[]> {
      const url = new URL(`${trimTrailingSlashes(options.supabaseUrl)}/rest/v1/ballot_public`);
      url.searchParams.set("select", "tracking_code,current_status,cast_date");
      url.searchParams.set("precinct_id", `eq.${precinctId}`);
      const rows = await doFetch(url.toString(), {
        cache: "no-store",
        // The publishable key alone: the anon role, reading only what the public may read.
        headers: { apikey: options.publishableKey },
      }).then(async (response) => {
        if (!response.ok) throw new ApiError(response.status, `ballot_public answered ${response.status}`);
        return response.json() as Promise<unknown>;
      });
      if (!Array.isArray(rows)) throw new ApiError(502, "unexpected response: ballot_public rows");
      return rows.map((row) => {
        const r = object(row);
        return { trackingCode: text(r.tracking_code, "tracking code"), status: status(r.current_status), castDate: text(r.cast_date, "cast date") };
      });
    },
  };
}

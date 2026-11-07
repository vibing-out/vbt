// Turns k6's end-of-test summary data into the results file committed under tests/load/results/.
// Pure (no k6 imports). Copies only allow-listed aggregate numbers, so tracking codes, URLs and
// times of day in the raw data can never reach the committed file (CLAUDE.md: no voter identity,
// no ordering leaks).

import { METRICS, TARGET_DESCRIPTION, type Endpoint } from "./config.ts";

interface K6Metric {
  values?: Record<string, number>;
  thresholds?: Record<string, { ok: boolean }>;
}
export interface K6SummaryData {
  metrics?: Record<string, K6Metric>;
}

export interface EndpointResult {
  requests: number;
  medianMs: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  errorRate: number | null;
  rateLimitedRate: number | null;
}

export interface LoadResults {
  version: 1;
  runDate: string;
  k6Version: string;
  target: string;
  nastyLimitsEmulated: false;
  tested: { trackRatePerSecond: number; recordRatePerSecond: number; duration: string };
  endpoints: Record<Endpoint, EndpointResult>;
  thresholdsPassed: boolean;
}

export interface RunMeta {
  /** Any time on the run's day; only the UTC date (YYYY-MM-DD) is kept. */
  now: Date;
  /** Output of `k6 version`; only the vX.Y.Z part is kept. */
  k6Version: string | undefined;
  trackRate: number;
  recordRate: number;
  duration: string;
}

const finite = (n: number | undefined): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);
const ms = (n: number | undefined) => {
  const v = finite(n);
  return v === null ? null : Math.round(v * 10) / 10;
};
const ratio = (n: number | undefined) => {
  const v = finite(n);
  return v === null ? null : Math.round(v * 10000) / 10000;
};

function endpointResult(data: K6SummaryData, endpoint: Endpoint): EndpointResult {
  const metrics = data.metrics ?? {};
  const duration = metrics[METRICS.duration200(endpoint)]?.values ?? {};
  const failed = metrics[METRICS.failed(endpoint)]?.values ?? {};
  const limited = metrics[METRICS.rateLimitedBy(endpoint)]?.values ?? {};
  return {
    requests: (finite(failed.passes) ?? 0) + (finite(failed.fails) ?? 0),
    medianMs: ms(duration.med),
    p95Ms: ms(duration["p(95)"]),
    p99Ms: ms(duration["p(99)"]),
    errorRate: ratio(failed.rate),
    rateLimitedRate: ratio(limited.rate),
  };
}

export function runDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function k6Version(raw: string | undefined): string {
  return /v\d+\.\d+\.\d+/.exec(raw ?? "")?.[0] ?? "unknown";
}

export function summarize(data: K6SummaryData, meta: RunMeta): LoadResults {
  const metrics = Object.values(data.metrics ?? {});
  const thresholds = metrics.flatMap((m) => Object.values(m.thresholds ?? {}));
  return {
    version: 1,
    runDate: runDate(meta.now),
    k6Version: k6Version(meta.k6Version),
    target: TARGET_DESCRIPTION,
    nastyLimitsEmulated: false,
    tested: { trackRatePerSecond: meta.trackRate, recordRatePerSecond: meta.recordRate, duration: meta.duration },
    endpoints: {
      track: endpointResult(data, "track"),
      record: endpointResult(data, "record"),
    },
    thresholdsPassed: thresholds.length > 0 && thresholds.every((t) => t.ok),
  };
}

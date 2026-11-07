// k6 entry for the T-12 load test: `k6 run tests/load/lookup.ts` from the repo root (see README.md).
// GET requests only. Never point it at Vercel production or hosted Supabase; config.ts refuses those hosts.

import http from "k6/http";
import exec from "k6/execution";
import { Rate } from "k6/metrics";
import {
  buildOptions,
  isExpectedStatus,
  isRateLimited,
  METRICS,
  NAME_TAGS,
  notFoundPaths,
  pathFor,
  requestPaths,
  settings,
  type Endpoint,
} from "./config.ts";
import { summarize } from "./summarize.ts";

const run = settings(__ENV);
const paths = requestPaths(run);
const unknownPaths = notFoundPaths(run);
export const options = buildOptions(__ENV);

// 429 from the /api/track rate limiter is expected, so it doesn't count toward http_req_failed;
// rate_limited (threshold < 5%) makes a heavily throttled run invalid instead.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));
// An UNKNOWN_CODES lookup should get 404; it counts toward track_not_found, not http_req_failed.
const notFoundExpected = http.expectedStatuses(404, 429);

const rateLimited = new Rate(METRICS.rateLimited);
const notFoundBy = { track: new Rate(METRICS.notFound("track")), record: new Rate(METRICS.notFound("record")) };
const failedBy = { track: new Rate(METRICS.failed("track")), record: new Rate(METRICS.failed("record")) };
const limitedBy = {
  track: new Rate(METRICS.rateLimitedBy("track")),
  record: new Rate(METRICS.rateLimitedBy("record")),
};

function lookup(endpoint: Endpoint) {
  const path = pathFor(paths, endpoint, exec.scenario.iterationInTest);
  const expectNotFound = unknownPaths.has(path);
  const res = http.get(`${run.baseUrl}${path}`, {
    tags: { endpoint, name: NAME_TAGS[endpoint] },
    ...(expectNotFound ? { responseCallback: notFoundExpected } : {}),
  });
  const limited = isRateLimited(res.status);
  rateLimited.add(limited);
  limitedBy[endpoint].add(limited);
  notFoundBy[endpoint].add(expectNotFound && res.status === 404);
  failedBy[endpoint].add(!isExpectedStatus(res.status, expectNotFound));
}

export function track() {
  lookup("track");
}

export function record() {
  lookup("record");
}

export function handleSummary(data: Parameters<typeof summarize>[0]) {
  const results = summarize(data, {
    now: new Date(),
    k6Version: __ENV.LOAD_K6_VERSION,
    trackRate: run.trackRate,
    recordRate: run.recordRate,
    duration: run.duration,
    target: run.targetDescription,
  });
  const json = `${JSON.stringify(results, null, 2)}\n`;
  return {
    stdout: json,
    [`tests/load/results/${results.runDate}.json`]: json,
  };
}

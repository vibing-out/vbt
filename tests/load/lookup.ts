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
  pathFor,
  requestPaths,
  settings,
  type Endpoint,
} from "./config.ts";
import { summarize } from "./summarize.ts";

const run = settings(__ENV);
const paths = requestPaths(run);
export const options = buildOptions(__ENV);

// 429 from the /api/track rate limiter is expected, so it doesn't count toward http_req_failed;
// rate_limited (threshold < 5%) makes a heavily throttled run invalid instead.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

const rateLimited = new Rate(METRICS.rateLimited);
const failedBy = { track: new Rate(METRICS.failed("track")), record: new Rate(METRICS.failed("record")) };
const limitedBy = {
  track: new Rate(METRICS.rateLimitedBy("track")),
  record: new Rate(METRICS.rateLimitedBy("record")),
};

function lookup(endpoint: Endpoint) {
  const path = pathFor(paths, endpoint, exec.scenario.iterationInTest);
  const res = http.get(`${run.baseUrl}${path}`, { tags: { endpoint, name: NAME_TAGS[endpoint] } });
  const limited = isRateLimited(res.status);
  rateLimited.add(limited);
  limitedBy[endpoint].add(limited);
  failedBy[endpoint].add(!isExpectedStatus(res.status));
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
  });
  const json = `${JSON.stringify(results, null, 2)}\n`;
  return {
    stdout: json,
    [`tests/load/results/${results.runDate}.json`]: json,
  };
}

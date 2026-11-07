// Load-test settings for the public lookup (T-12). Pure: no k6 imports, so Vitest can test it without k6.
// lookup.ts passes k6's __ENV in; the tests pass plain objects.

export type Env = Readonly<Record<string, string | undefined>>;
export type Endpoint = "track" | "record";
export const ENDPOINTS: readonly Endpoint[] = ["track", "record"];

export const DEFAULTS = {
  baseUrl: "http://localhost:3000",
  trackRate: 50,
  recordRate: 5,
  duration: "5m",
  preAllocatedVUs: 50,
  maxVUs: 150,
} as const;

/** p95 budget for a successful lookup, from ticket #24's acceptance criteria. */
export const P95_BUDGET_MS = 500;
export const MAX_ERROR_RATE = 0.01;
export const MAX_RATE_LIMITED = 0.05;

/** Written into the results file instead of the base URL, so no URL is ever committed. */
export const TARGET_DESCRIPTION =
  "Production build of apps/web (next build && next start) outside Vercel, against a local Supabase stack " +
  "(supabase start: migrations + supabase/seed.sql)";

/** Custom metrics recorded by lookup.ts. Custom metrics always reach handleSummary, with or without thresholds. */
export const METRICS = {
  rateLimited: "rate_limited",
  failed: (endpoint: Endpoint) => `${endpoint}_failed`,
  rateLimitedBy: (endpoint: Endpoint) => `${endpoint}_rate_limited`,
  duration200: (endpoint: Endpoint) => `http_req_duration{endpoint:${endpoint},status:200}`,
} as const;

// Hosts that must never be load-tested: Vercel allows load tests only on Enterprise plans with prior
// approval, and hosted Supabase holds insert-only election data.
const FORBIDDEN_HOSTS = [/(^|\.)ballottrack\.org$/i, /\.vercel\.app$/i, /\.supabase\.co$/i];

export function baseUrl(env: Env): string {
  const raw = (env.BASE_URL ?? DEFAULTS.baseUrl).trim().replace(/\/+$/, "");
  const match = /^https?:\/\/([^/:?#]+)(:\d+)?$/i.exec(raw);
  if (!match?.[1]) throw new Error("BASE_URL must be an http(s) origin such as http://localhost:3000");
  const host = match[1];
  if (FORBIDDEN_HOSTS.some((pattern) => pattern.test(host))) {
    throw new Error(`BASE_URL host ${host} is not a load-test target; run against a local production build`);
  }
  return raw;
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) throw new Error(`${name} must be a positive whole number of requests per second`);
  return Number(raw);
}

function duration(env: Env): string {
  const raw = env.DURATION;
  if (raw === undefined || raw === "") return DEFAULTS.duration;
  if (!/^(?=\d)(\d+h)?(\d+m)?(\d+s)?$/.test(raw)) throw new Error("DURATION must be a k6 duration such as 30s, 5m or 1m30s");
  return raw;
}

export interface Settings {
  baseUrl: string;
  trackRate: number;
  recordRate: number;
  duration: string;
}

export function settings(env: Env): Settings {
  return {
    baseUrl: baseUrl(env),
    trackRate: positiveInt(env, "TRACK_RATE", DEFAULTS.trackRate),
    recordRate: positiveInt(env, "RECORD_RATE", DEFAULTS.recordRate),
    duration: duration(env),
  };
}

function scenario(rate: number, runFor: string, exec: Endpoint) {
  return {
    executor: "constant-arrival-rate" as const,
    rate,
    timeUnit: "1s",
    duration: runFor,
    preAllocatedVUs: DEFAULTS.preAllocatedVUs,
    maxVUs: DEFAULTS.maxVUs,
    exec,
  };
}

/** k6 `options`: one constant-arrival-rate scenario per endpoint, and the pass criteria as thresholds. */
export function buildOptions(env: Env) {
  const s = settings(env);
  return {
    scenarios: {
      track: scenario(s.trackRate, s.duration, "track"),
      record: scenario(s.recordRate, s.duration, "record"),
    },
    thresholds: {
      [METRICS.duration200("track")]: [`p(95)<${P95_BUDGET_MS}`],
      [METRICS.duration200("record")]: [`p(95)<${P95_BUDGET_MS}`],
      http_req_failed: [`rate<${MAX_ERROR_RATE}`],
      [METRICS.rateLimited]: [`rate<${MAX_RATE_LIMITED}`],
    },
    summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  };
}

// Test data: the 50 synthetic ballots in supabase/seed.sql (SEED-0001 .. SEED-0050, three precincts).
export const SEED_CODES: readonly string[] = Array.from({ length: 50 }, (_, i) => `SEED-${String(i + 1).padStart(4, "0")}`);
export const RECORD_TARGETS: readonly { scope: string; stage: string }[] = [
  { scope: "18097-001", stage: "TALLIED_PRECINCT" },
  { scope: "18097-002", stage: "TALLIED_PRECINCT" },
  { scope: "18057-001", stage: "TALLIED_PRECINCT" },
];

export const trackPath = (code: string) => `/api/track/${encodeURIComponent(code)}`;
export const recordPath = (scope: string, stage: string) =>
  `/api/record/${encodeURIComponent(scope)}/${encodeURIComponent(stage)}`;

/** k6 `name` tag per endpoint: groups every code under one template, so per-code URLs stay out of the metrics. */
export const NAME_TAGS: Readonly<Record<Endpoint, string>> = {
  track: "/api/track/{code}",
  record: "/api/record/{scope}/{stage}",
};

export const TRACK_PATHS: readonly string[] = SEED_CODES.map(trackPath);
export const RECORD_PATHS: readonly string[] = RECORD_TARGETS.map((t) => recordPath(t.scope, t.stage));

/** Round-robin over the paths, so every iteration picks a deterministic target. */
export function pathFor(endpoint: Endpoint, iteration: number): string {
  const paths = endpoint === "track" ? TRACK_PATHS : RECORD_PATHS;
  const index = ((Math.trunc(iteration) % paths.length) + paths.length) % paths.length;
  return paths[index] as string;
}

/** Same rule as lookup.ts's setResponseCallback: 2xx/3xx, and 429 from the /api/track rate limiter, are expected. */
export const isExpectedStatus = (status: number) => (status >= 200 && status <= 399) || status === 429;
export const isRateLimited = (status: number) => status === 429;

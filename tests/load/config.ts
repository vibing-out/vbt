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
  /** Per scenario; two scenarios cap the run at 150 VUs in total. */
  maxVUs: 75,
  /** The three precincts in supabase/seed.sql. */
  recordScopes: ["18097-001", "18097-002", "18057-001"],
  recordStage: "TALLIED_PRECINCT",
} as const;

/** p95 budget for a successful lookup, from ticket #24's acceptance criteria. */
export const P95_BUDGET_MS = 500;
export const MAX_ERROR_RATE = 0.01;
export const MAX_RATE_LIMITED = 0.05;

/**
 * Written into the results file instead of the base URL, so no URL is ever committed. The TARGET_DESCRIPTION
 * variable overrides it when the run targets something else, such as a build that reads no database.
 */
export const DEFAULT_TARGET_DESCRIPTION =
  "Production build of apps/web (next build && next start) outside Vercel, against a local Supabase stack " +
  "(supabase start: migrations + supabase/seed.sql)";

/** Custom metrics recorded by lookup.ts. Custom metrics always reach handleSummary, with or without thresholds. */
export const METRICS = {
  rateLimited: "rate_limited",
  /** Share of an endpoint's requests that got the 404 expected for an UNKNOWN_CODES code. */
  notFound: (endpoint: Endpoint) => `${endpoint}_not_found`,
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

function wholeNumber(env: Env, name: string, fallback: number, unit: string, min: 0 | 1): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min) {
    throw new Error(`${name} must be a ${min === 0 ? "non-negative" : "positive"} whole number of ${unit}`);
  }
  return Number(raw);
}

const positiveInt = (env: Env, name: string, fallback: number, unit: string) => wholeNumber(env, name, fallback, unit, 1);

/** Comma-separated list; undefined when unset or blank, an error when any entry is empty. */
function list(env: Env, name: string): string[] | undefined {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const entries = raw.split(",").map((entry) => entry.trim());
  if (entries.some((entry) => entry === "")) throw new Error(`${name} must be a comma-separated list with no empty entries`);
  return entries;
}

// Path template values for /api/record/{scope}/{stage}. Overridable so the script follows the scope and
// stage shapes later tickets add to docs/locked-interfaces.md without a code change. Only emptiness is
// checked; recordPath URL-encodes whatever is given.
function recordScopes(env: Env): readonly string[] {
  return list(env, "RECORD_SCOPES") ?? DEFAULTS.recordScopes;
}

// Tracking codes. TRACK_CODES are codes the target holds (expected 200); UNKNOWN_CODES are codes it must not
// hold (expected 404). A code in both lists is a configuration error, since its expected status is ambiguous.
function trackCodes(env: Env): { known: readonly string[]; unknown: readonly string[] } {
  const known = list(env, "TRACK_CODES") ?? SEED_CODES;
  const unknown = list(env, "UNKNOWN_CODES") ?? [];
  const overlap = unknown.filter((code) => known.includes(code));
  if (overlap.length > 0) throw new Error("UNKNOWN_CODES must not repeat a TRACK_CODES entry");
  return { known, unknown };
}

function targetDescription(env: Env): string {
  const raw = env.TARGET_DESCRIPTION?.trim();
  if (raw === undefined || raw === "") return DEFAULT_TARGET_DESCRIPTION;
  // The description is committed, so it must not smuggle in the URL the default exists to keep out.
  if (/:\/\/|localhost|\d+\.\d+\.\d+\.\d+/i.test(raw)) throw new Error("TARGET_DESCRIPTION must describe the target, not give its URL or host");
  return raw;
}

function recordStage(env: Env): string {
  const raw = env.RECORD_STAGE?.trim();
  return raw === undefined || raw === "" ? DEFAULTS.recordStage : raw;
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
  maxVUs: number;
  recordTargets: readonly RecordTarget[];
  trackCodes: readonly string[];
  unknownCodes: readonly string[];
  targetDescription: string;
}

export interface RecordTarget {
  scope: string;
  stage: string;
}

export function settings(env: Env): Settings {
  const stage = recordStage(env);
  const codes = trackCodes(env);
  return {
    baseUrl: baseUrl(env),
    trackRate: positiveInt(env, "TRACK_RATE", DEFAULTS.trackRate, "requests per second"),
    // 0 turns the record scenario off, for targets that have no /api/record route.
    recordRate: wholeNumber(env, "RECORD_RATE", DEFAULTS.recordRate, "requests per second", 0),
    duration: duration(env),
    maxVUs: positiveInt(env, "MAX_VUS", DEFAULTS.maxVUs, "VUs per scenario"),
    recordTargets: recordScopes(env).map((scope) => ({ scope, stage })),
    trackCodes: codes.known,
    unknownCodes: codes.unknown,
    targetDescription: targetDescription(env),
  };
}

function scenario(rate: number, s: Settings, exec: Endpoint) {
  return {
    executor: "constant-arrival-rate" as const,
    rate,
    timeUnit: "1s",
    duration: s.duration,
    // k6 rejects preAllocatedVUs above maxVUs, so a lower MAX_VUS lowers it too.
    preAllocatedVUs: Math.min(DEFAULTS.preAllocatedVUs, s.maxVUs),
    maxVUs: s.maxVUs,
    exec,
  };
}

/** Endpoints a run sends traffic to: track always, record unless RECORD_RATE is 0. */
export function activeEndpoints(s: Pick<Settings, "recordRate">): readonly Endpoint[] {
  return s.recordRate > 0 ? ENDPOINTS : ["track"];
}

/** k6 `options`: one constant-arrival-rate scenario per active endpoint, and the pass criteria as thresholds. */
export function buildOptions(env: Env) {
  const s = settings(env);
  const active = activeEndpoints(s);
  const rates: Record<Endpoint, number> = { track: s.trackRate, record: s.recordRate };
  return {
    scenarios: Object.fromEntries(active.map((e) => [e, scenario(rates[e], s, e)])) as Partial<
      Record<Endpoint, ReturnType<typeof scenario>>
    >,
    thresholds: {
      // A p95 threshold on an endpoint with no traffic would have no samples, so only active endpoints get one.
      ...Object.fromEntries(active.map((e) => [METRICS.duration200(e), [`p(95)<${P95_BUDGET_MS}`]])),
      http_req_failed: [`rate<${MAX_ERROR_RATE}`],
      [METRICS.rateLimited]: [`rate<${MAX_RATE_LIMITED}`],
    },
    summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  };
}

// Test data: the 50 synthetic ballots in supabase/seed.sql (SEED-0001 .. SEED-0050, three precincts).
// The record targets default to its precincts at TALLIED_PRECINCT (DEFAULTS, overridable in settings).
export const SEED_CODES: readonly string[] = Array.from({ length: 50 }, (_, i) => `SEED-${String(i + 1).padStart(4, "0")}`);

export const trackPath = (code: string) => `/api/track/${encodeURIComponent(code)}`;
export const recordPath = (scope: string, stage: string) =>
  `/api/record/${encodeURIComponent(scope)}/${encodeURIComponent(stage)}`;

/** k6 `name` tag per endpoint: groups every code under one template, so per-code URLs stay out of the metrics. */
export const NAME_TAGS: Readonly<Record<Endpoint, string>> = {
  track: "/api/track/{code}",
  record: "/api/record/{scope}/{stage}",
};

export type RequestPaths = Readonly<Record<Endpoint, readonly string[]>>;

/** Every path a run requests, per endpoint. Known and unknown codes interleave in the round-robin. */
export function requestPaths(s: Pick<Settings, "recordTargets" | "trackCodes" | "unknownCodes">): RequestPaths {
  return {
    track: [...s.trackCodes, ...s.unknownCodes].map(trackPath),
    record: s.recordTargets.map((t) => recordPath(t.scope, t.stage)),
  };
}

/** Paths whose expected answer is 404: the UNKNOWN_CODES lookups. */
export function notFoundPaths(s: Pick<Settings, "unknownCodes">): ReadonlySet<string> {
  return new Set(s.unknownCodes.map(trackPath));
}

/** Round-robin over the endpoint's paths, so every iteration picks a deterministic target. */
export function pathFor(paths: RequestPaths, endpoint: Endpoint, iteration: number): string {
  const list = paths[endpoint];
  const index = ((Math.trunc(iteration) % list.length) + list.length) % list.length;
  return list[index] as string;
}

/**
 * Same rule as lookup.ts's response callbacks: 2xx/3xx, and 429 from the /api/track rate limiter, are expected;
 * for an unknown code, 404 (and 429) is expected and anything else, a 200 included, is a failure.
 */
export const isExpectedStatus = (status: number, expectNotFound = false) =>
  expectNotFound ? status === 404 || status === 429 : (status >= 200 && status <= 399) || status === 429;
export const isRateLimited = (status: number) => status === 429;

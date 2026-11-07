// GET /api/track/{code}: rate limit, normalise, look up, hold to the minimum time, respond.
// Dependencies are injected so the route can be tested without the network; app/api/track/[code]/route.ts
// wires the real ones.
//
// Unknown, malformed and failed lookups get one byte-identical 404, and every response takes at least
// MIN_RESPONSE_MS, so neither the body nor the timing reveals whether a code exists (Principle 1;
// OWASP Authentication Cheat Sheet § "Authentication and Error Messages").
import { isWellFormedCode, normaliseCode } from "./code";
import { NOT_FOUND_MESSAGE } from "./copy";
import { RETRY_AFTER_SECONDS } from "./rate-limit";
import type { TrackResult } from "./types";

export const MIN_RESPONSE_MS = 300;

export const NOT_FOUND_BODY = Object.freeze({ error: "not_found", message: NOT_FOUND_MESSAGE });
export const RATE_LIMITED_BODY = Object.freeze({ error: "rate_limited" });

export interface TrackHandlerDeps {
  isRateLimited: (request: Request) => Promise<boolean>;
  lookup: (code: string) => Promise<TrackResult | null>;
  minDurationMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function handleTrackRequest(request: Request, rawCode: string, deps: TrackHandlerDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? realSleep;
  const minDuration = deps.minDurationMs ?? MIN_RESPONSE_MS;
  const started = now();

  const respond = async (body: unknown, status: number, headers: Record<string, string> = {}) => {
    const wait = minDuration - (now() - started);
    if (wait > 0) await sleep(wait);
    return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
  };

  let limited = false;
  try {
    limited = await deps.isRateLimited(request);
  } catch {
    limited = false; // fail open, as the limiter itself does
  }
  if (limited) return respond(RATE_LIMITED_BODY, 429, { "Retry-After": String(RETRY_AFTER_SECONDS) });

  const code = normaliseCode(rawCode);
  if (!isWellFormedCode(code)) return respond(NOT_FOUND_BODY, 404);

  let result: TrackResult | null = null;
  try {
    result = await deps.lookup(code);
  } catch {
    result = null;
  }
  return result ? respond(result, 200) : respond(NOT_FOUND_BODY, 404);
}

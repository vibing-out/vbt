// Rate limiting for GET /api/track/{code} through the Vercel Firewall rate-limiting SDK
// (https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting-sdk). A human creates the matching
// Firewall rule (condition @vercel/firewall, Rate limit ID "track-lookup"); agents can't change Vercel
// config.
//
// Fails open: if the check throws or times out (no rule, local `next start` without a client IP, a
// network error), the request is served. The public read path stays up; failing closed is a one-line
// change here. Nothing about the error is logged, so no code or IP reaches a log.
import { checkRateLimit } from "@vercel/firewall";

export const TRACK_RATE_LIMIT_ID = "track-lookup";
export const RATE_LIMIT_TIMEOUT_MS = 1000;
/** Seconds a limited client is told to wait. */
export const RETRY_AFTER_SECONDS = 30;

/** Resolves true when the request is rate-limited. Never rejects. */
export type RateLimiter = (request: Request) => Promise<boolean>;

export const firewallRateLimiter: RateLimiter = async (request) => {
  try {
    const { rateLimited } = await checkRateLimit(TRACK_RATE_LIMIT_ID, { request, timeout: RATE_LIMIT_TIMEOUT_MS });
    return rateLimited === true;
  } catch {
    return false;
  }
};

// Where the receipt's QR code and printed web address point. The tracker page for one ballot is
// `<base>/track/<tracking_code>` (T-08 serves /track/[code]).

/** Production tracker, used when RECEIPT_TRACKER_BASE_URL is not set. */
export const DEFAULT_TRACKER_BASE_URL = "https://www.ballottrack.org";

/** Placeholder phone line printed on the receipt (555-01xx is reserved for fiction). */
export const PLACEHOLDER_PHONE = "(317) 555-0100";

/** Name of the environment variable that overrides the tracker base URL. */
export const TRACKER_BASE_URL_ENV = "RECEIPT_TRACKER_BASE_URL";

/**
 * Validates a tracker base URL and returns it without a trailing slash. Only http(s) origins with an
 * optional path are allowed; query strings and fragments would corrupt `<base>/track/<code>`.
 */
export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`${TRACKER_BASE_URL_ENV} is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${TRACKER_BASE_URL_ENV} must be an http(s) URL: ${raw}`);
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new Error(`${TRACKER_BASE_URL_ENV} must not carry credentials, a query or a fragment: ${raw}`);
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/** The tracker base URL from the environment, or the production default. */
export function trackerBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env[TRACKER_BASE_URL_ENV];
  return normalizeBaseUrl(raw && raw.trim() !== "" ? raw : DEFAULT_TRACKER_BASE_URL);
}

/** The URL the QR code encodes: the tracking page for exactly this code. */
export function trackerUrl(baseUrl: string, trackingCode: string): string {
  return `${normalizeBaseUrl(baseUrl)}/track/${encodeURIComponent(trackingCode)}`;
}

/** The short web address printed for voters who type it in, e.g. `www.ballottrack.org/track`. */
export function printedWebAddress(baseUrl: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  return `${url.host}${url.pathname.replace(/\/+$/, "")}/track`;
}

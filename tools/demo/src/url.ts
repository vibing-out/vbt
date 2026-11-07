// URL helpers shared by the seed and the HTTP ports.

/**
 * The base URL without its trailing slashes, so `${base}/path` never doubles one.
 * A linear scan instead of `/\/+$/`: that regex backtracks quadratically on a long run of slashes, and the
 * base URL comes from the caller (environment or route), so it is not trusted.
 */
export function trimTrailingSlashes(baseUrl: string): string {
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 0x2f) end--;
  return baseUrl.slice(0, end);
}

// Reads the text of a scanned QR code and returns the tracking code only when it is one of our receipts:
// an http(s) URL on an allowed host whose path is exactly /track/{code}, with a well-formed code.
// The caller navigates to a path it builds from the returned code, never to the scanned URL itself,
// so a QR code cannot send the voter anywhere else.

/** Hosts whose receipts the scanner accepts, besides the host serving the page. */
export const RECEIPT_HOSTS = ["www.ballottrack.org", "ballottrack.org"] as const;

const RECEIPT_PATH = /^\/track\/([^/]+)$/;

export function parseReceiptQr(text: string, opts: { hosts: readonly string[]; codePattern: RegExp }): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (!opts.hosts.map((h) => h.toLowerCase()).includes(url.host.toLowerCase())) return null;
  const match = RECEIPT_PATH.exec(url.pathname);
  if (!match) return null;
  let code: string;
  try {
    code = decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
  return opts.codePattern.test(code) ? code : null;
}

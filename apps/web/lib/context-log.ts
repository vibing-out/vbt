import "server-only";

// Reads the shared context log (Supabase project vbt-context-log). Mirrors the sign-in and
// search_context call in scripts/context.ts, but reads the web server's own CONTEXT_* names.
// Server-only: the password and the signed-in token never reach the browser.
// Every reader returns null when the env is missing or a call fails, so a page can show
// "unavailable" (distinct from an empty result, which means the log was read and had nothing).

type Env = Readonly<Record<string, string | undefined>>;
type Row = { id?: unknown; created_at?: unknown; topic?: unknown; body?: unknown };
type Search = { type?: "decision" | "correction"; limit: number };
// The status page reads live; the factory page passes nothing and caches through its route segment.
type Cache = Pick<RequestInit, "cache">;

async function searchContext({ type, limit }: Search, env: Env, cache: Cache): Promise<Row[] | null> {
  const url = env.CONTEXT_SUPABASE_URL?.replace(/\/$/, "");
  const apikey = env.CONTEXT_SUPABASE_PUBLISHABLE_KEY;
  const email = env.CONTEXT_EMAIL;
  const password = env.CONTEXT_PASSWORD;
  if (!url || !apikey || !email || !password) return null;
  try {
    const tokenResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      ...cache,
    });
    if (!tokenResponse.ok) return null;
    const { access_token } = (await tokenResponse.json()) as { access_token?: string };
    if (!access_token) return null;
    const rowsResponse = await fetch(`${url}/rest/v1/rpc/search_context`, {
      method: "POST",
      headers: { apikey, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_query: "", p_topic: null, p_type: type ?? null, p_since: null, p_limit: limit }),
      ...cache,
    });
    if (!rowsResponse.ok) return null;
    const rows = (await rowsResponse.json()) as unknown;
    return Array.isArray(rows) ? (rows as Row[]) : null;
  } catch {
    return null;
  }
}

/** Number of recent entries (up to 20), read live for the status page. */
export async function countContextEntries(env: Env = process.env): Promise<number | null> {
  const rows = await searchContext({ limit: 20 }, env, { cache: "no-store" });
  return rows === null ? null : rows.length;
}

export type Correction = { id: number; date: string; topic: string; claim: string; caughtBy: string; fix: string };

// scripts/context.ts stores a correction body as "<claim> | caught by: <x> | fix: <y> | evidence: <z>".
const CORRECTION_BODY = /^(?<claim>[\s\S]+?) \| caught by: (?<caughtBy>[\s\S]+?) \| fix: (?<fix>[\s\S]+?)(?: \| evidence: [\s\S]*)?$/;

/** Splits a stored correction body into its parts; null for a body not in that shape. */
export function parseCorrection(row: Row): Correction | null {
  if (typeof row.id !== "number" || typeof row.body !== "string") return null;
  const parts = CORRECTION_BODY.exec(row.body)?.groups;
  if (!parts) return null;
  return {
    id: row.id,
    date: typeof row.created_at === "string" ? row.created_at.slice(0, 10) : "",
    topic: typeof row.topic === "string" ? row.topic : "",
    claim: parts.claim!.trim(),
    caughtBy: parts.caughtBy!.trim(),
    fix: parts.fix!.trim(),
  };
}

/** The latest corrections (where the AI was wrong, how it was caught, the fix), newest first. */
export async function recentCorrections(limit = 6, env: Env = process.env): Promise<Correction[] | null> {
  const rows = await searchContext({ type: "correction", limit }, env, {});
  if (rows === null) return null;
  return rows.map(parseCorrection).filter((c): c is Correction => c !== null);
}

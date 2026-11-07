import "server-only";

// Counts entries in the shared context log (Supabase project vbt-context-log). Mirrors the sign-in
// and search_context call in scripts/context.ts, but reads the web server's own CONTEXT_* names.
// Server-only: the password and the signed-in token never reach the browser.
// Returns null when the env is missing or a call fails, so the page shows "Context log: unavailable"
// (distinct from 0, which means the log was read and has no entries).
export async function countContextEntries(env: Readonly<Record<string, string | undefined>> = process.env): Promise<number | null> {
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
      cache: "no-store",
    });
    if (!tokenResponse.ok) return null;
    const { access_token } = (await tokenResponse.json()) as { access_token?: string };
    if (!access_token) return null;
    const rowsResponse = await fetch(`${url}/rest/v1/rpc/search_context`, {
      method: "POST",
      headers: { apikey, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_query: "", p_topic: null, p_type: null, p_since: null, p_limit: 20 }),
      cache: "no-store",
    });
    if (!rowsResponse.ok) return null;
    const rows = (await rowsResponse.json()) as unknown;
    return Array.isArray(rows) ? rows.length : null;
  } catch {
    return null;
  }
}

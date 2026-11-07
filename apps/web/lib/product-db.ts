import "server-only";

// Reads the hello-world greeting from the product database (public.app_info, key = 'greeting').
// Server-only: uses just the two public product names and the publishable key, which RLS limits to
// reading app_info. Returns null when the env is missing or the read fails, so the page still renders.
export async function readGreeting(env: Readonly<Record<string, string | undefined>> = process.env): Promise<string | null> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const response = await fetch(`${url}/rest/v1/app_info?key=eq.greeting&select=value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows)) return null;
    const value = (rows[0] as { value?: unknown } | undefined)?.value;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

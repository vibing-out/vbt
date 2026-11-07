import type { OfficialTarget } from "@vbt/domain";
import { OFFICIAL_ROLES } from "@vbt/domain";
import { type NextRequest, NextResponse } from "next/server";
import { forbidden, parseTarget, requireRole } from "./lib/require-role";

// Next 16 proxy (formerly middleware; runs on Node) for the official pages (T-09). Every /official path
// answers 403 unless requireRole passes: an aal2, live session of an official, in scope for the precinct or
// county in the path or query. It reads the @supabase/ssr cookies and writes a refreshed session back. Each page
// re-checks on the server (lib/page-guard.ts); the API routes check for themselves.

export const config = { matcher: ["/official", "/official/:path*"] };

/** The precinct or county an /official path acts on, if any. */
export function pathTarget(pathname: string): OfficialTarget | undefined {
  const match = /^\/official\/(precinct|county)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return undefined;
  let id: string;
  try {
    id = decodeURIComponent(match[2]!);
  } catch {
    id = "";
  }
  return { scope: match[1] as "precinct" | "county", id };
}

export async function proxy(request: NextRequest): Promise<Response> {
  const refreshed: Array<{ name: string; value: string; options?: Record<string, unknown> }> = [];
  // The target is in the path (/official/precinct/<id>) or the query (?precinct= or ?county=).
  const query = parseTarget(request.nextUrl.searchParams);
  if (query === null) return forbidden();
  const target = pathTarget(request.nextUrl.pathname) ?? query;
  const auth = await requireRole(request, OFFICIAL_ROLES, target, {
    cookies: async () => ({
      getAll: () => request.cookies.getAll().map(({ name, value }) => ({ name, value })),
      set: (name, value, options) => {
        refreshed.push({ name, value, options });
      },
    }),
  });
  if (!auth.ok) return auth.response;

  const response = NextResponse.next();
  for (const { name, value, options } of refreshed) response.cookies.set(name, value, options);
  return response;
}

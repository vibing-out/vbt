import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  type OfficialGrant,
  type OfficialRole,
  type OfficialTarget,
  officialMayActOn,
  toOfficialGrant,
} from "@vbt/domain";
import { cookies as nextCookies } from "next/headers";

// The one gate for every official endpoint (T-20). A request passes only when:
//   1. it carries a Supabase session, verified with auth.getClaims (never getSession): the
//      Authorization: Bearer token when the header is present, otherwise the @supabase/ssr cookies;
//   2. the session is multi-factor (JWT aal === "aal2") and is a signed-in, non-anonymous user;
//   2b. the session is still live: auth.getUser asks the Auth server, so a signed-out or revoked
//      session is refused before its token expires;
//   3. the user's official_roles grant, read through PostgREST with the publishable key and the user's
//      own token (RLS returns only their own row, and only at aal2), has one of the allowed roles;
//   4. when the endpoint acts on a precinct or county, the grant covers it (@vbt/domain officialMayActOn).
// Anything else, including missing env and any lookup failure, is a 403 with the same body: it fails
// closed and does not say why. No secret key is used here. Writes stay with service_role, after this.

type Env = Readonly<Record<string, string | undefined>>;

interface CookieStore {
  getAll(): Array<{ name: string; value: string }>;
  set?(name: string, value: string, options?: Record<string, unknown>): unknown;
}

export interface RequireRoleDeps {
  env?: Env;
  fetch?: typeof fetch;
  /** The request's cookies; defaults to next/headers cookies(). */
  cookies?: () => Promise<CookieStore>;
}

export type Official = OfficialGrant & { readonly userId: string };

export type RequireRoleResult =
  | { readonly ok: true; readonly official: Official }
  | { readonly ok: false; readonly response: Response };

/** The single response for every refused official request. */
export function forbidden(): Response {
  return Response.json({ error: "forbidden" }, { status: 403, headers: { "cache-control": "no-store" } });
}

const DENY = (): RequireRoleResult => ({ ok: false, response: forbidden() });

const MAX_TARGET_ID = 64;

/**
 * Reads an endpoint's target from `?precinct=<id>` or `?county=<id>`. Returns undefined when neither is
 * given, and null when the query is not exactly one non-empty, single-valued target (refuse it).
 */
export function parseTarget(params: URLSearchParams): OfficialTarget | undefined | null {
  const precinct = params.getAll("precinct");
  const county = params.getAll("county");
  if (precinct.length === 0 && county.length === 0) return undefined;
  if (precinct.length + county.length !== 1) return null;
  const scope = precinct.length === 1 ? "precinct" : "county";
  const id = (precinct[0] ?? county[0] ?? "").trim();
  if (id === "" || id.length > MAX_TARGET_ID) return null;
  return { scope, id };
}

/** The token from `Authorization: Bearer <token>`; null when the header is absent, "" when malformed. */
function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? "";
}

async function defaultCookies(): Promise<CookieStore> {
  return nextCookies();
}

function sessionClient(
  url: string,
  key: string,
  fetchImpl: typeof fetch,
  token: string | null,
  store: CookieStore | null,
): SupabaseClient {
  if (token !== null) {
    // The user's token on every PostgREST call, so RLS sees their claims; nothing is stored.
    return createClient(url, key, {
      global: { fetch: fetchImpl, headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return createServerClient(url, key, {
    global: { fetch: fetchImpl },
    cookies: {
      getAll: () => store?.getAll() ?? [],
      // Route handlers may set cookies, so a refreshed session is kept. Elsewhere set throws: ignore it
      // (the session-refresh proxy arrives with the login screens, T-09).
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store?.set?.(name, value, options);
        } catch {
          // not settable in this context
        }
      },
    },
  });
}

/** The county a target belongs to, from the public precincts table; null when unknown. Throws on error. */
async function targetCounty(client: SupabaseClient, target: OfficialTarget): Promise<string | null> {
  const column = target.scope === "precinct" ? "id" : "county_id";
  const { data, error } = await client.from("precincts").select("county_id").eq(column, target.id).limit(1).retry(false);
  if (error || !Array.isArray(data)) throw new Error("precinct lookup failed");
  const county = (data[0] as { county_id?: unknown } | undefined)?.county_id;
  return typeof county === "string" ? county : null;
}

/**
 * Allows the request only for a multi-factor (aal2) official holding one of `roles`, and, when
 * `target` is given, whose scope covers it. On refusal, return `result.response` (403) as is.
 */
export async function requireRole(
  request: Request,
  roles: readonly OfficialRole[],
  target?: OfficialTarget,
  deps: RequireRoleDeps = {},
): Promise<RequireRoleResult> {
  try {
    const env = deps.env ?? process.env;
    const url = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key || roles.length === 0) return DENY();

    const token = bearerToken(request);
    if (token === "") return DENY();
    const store = token === null ? await (deps.cookies ?? defaultCookies)() : null;
    const fetchImpl: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
    const client = sessionClient(url, key, fetchImpl, token, store);

    const { data, error } = token === null ? await client.auth.getClaims() : await client.auth.getClaims(token);
    const claims = error ? null : data?.claims;
    if (!claims) return DENY();
    if (claims.aal !== "aal2") return DENY();
    if (claims.role !== "authenticated" || claims.is_anonymous === true) return DENY();
    const userId = claims.sub;
    if (typeof userId !== "string" || userId === "") return DENY();

    // A verified JWT outlives sign-out and admin revocation until it expires, so ask the Auth server
    // whether its session is still live (GoTrue's /user refuses a token whose session_id is gone). The
    // aal and role checks above stay on the verified claims.
    const live = token === null ? await client.auth.getUser() : await client.auth.getUser(token);
    if (live.error || live.data.user?.id !== userId) return DENY();

    // No retries (postgrest-js retries GETs with backoff by default): a gate fails fast and closed.
    const lookup = await client
      .from("official_roles")
      .select("role, scope, scope_id")
      .eq("user_id", userId)
      .limit(2)
      .retry(false);
    if (lookup.error || !Array.isArray(lookup.data) || lookup.data.length !== 1) return DENY();
    const grant = toOfficialGrant(lookup.data[0]);
    if (!grant || !roles.includes(grant.role)) return DENY();

    if (target !== undefined && !officialMayActOn(grant, target, await targetCounty(client, target))) return DENY();

    return { ok: true, official: { ...grant, userId } };
  } catch {
    return DENY();
  }
}

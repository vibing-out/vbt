// Test-only: a fake Supabase project for lib/require-role tests. It signs real ES256 JWTs and serves
// their JWKS, so auth.getClaims verifies signatures for real, and it answers PostgREST reads of
// official_roles the way the migration's RLS does (own row, aal2 only) and of precincts (public).
// Its /auth/v1/user plays GoTrue: only a token it signed, unexpired, whose session_id is still live.
// Never imported by app code.

export const SUPABASE_URL = "https://demo.supabase.co";
export const PUBLISHABLE_KEY = "sb_publishable_test";
export const ENV = { NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY };
/** @supabase/ssr's cookie name for SUPABASE_URL: sb-<first host label>-auth-token. */
export const AUTH_COOKIE = "sb-demo-auth-token";

export const USERS = {
  pollWorker: "00000000-0000-4000-8000-000000000001",
  county: "00000000-0000-4000-8000-000000000002",
  state: "00000000-0000-4000-8000-000000000003",
  noGrant: "00000000-0000-4000-8000-000000000004",
} as const;

export const GRANTS: Record<string, unknown> = {
  [USERS.pollWorker]: { role: "poll_worker", scope: "precinct", scope_id: "18097-001" },
  [USERS.county]: { role: "county", scope: "county", scope_id: "18097" },
  [USERS.state]: { role: "state", scope: null, scope_id: null },
};

// supabase/seed.sql precincts.
export const PRECINCTS = [
  { id: "18097-001", county_id: "18097" },
  { id: "18097-002", county_id: "18097" },
  { id: "18057-001", county_id: "18057" },
];

const KID = "test-signing-key";
const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

const b64url = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes).toString("base64url");

const projectKey = await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
const forgerKey = await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", projectKey.publicKey)), kid: KID, alg: "ES256", use: "sig" };

export interface SignOptions {
  /** Sign with a key the project does not trust. */
  forged?: boolean;
  kid?: string;
}

/** The session_id every token carries unless a test gives its own. */
export const LIVE_SESSION = "00000000-0000-4000-8000-0000000000aa";

/** A Supabase-style access token. Defaults: an authenticated session valid for an hour. */
export async function accessToken(claims: Record<string, unknown>, options: SignOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: options.kid ?? KID }));
  const payload = b64url(
    JSON.stringify({ iss: `${SUPABASE_URL}/auth/v1`, aud: "authenticated", role: "authenticated", iat: now, exp: now + 3600, session_id: LIVE_SESSION, ...claims }),
  );
  const key = options.forged ? forgerKey.privateKey : projectKey.privateKey;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

/** An aal2 token for a user. */
export const aal2 = (sub: string, extra: Record<string, unknown> = {}) => accessToken({ sub, aal: "aal2", ...extra });

/** The cookie @supabase/ssr writes for a session holding this access token. */
export function sessionCookie(token: string): { name: string; value: string } {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as { sub?: string };
  const session = {
    access_token: token,
    refresh_token: "refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id: payload.sub, aud: "authenticated", role: "authenticated" },
  };
  return { name: AUTH_COOKIE, value: `base64-${b64url(JSON.stringify(session))}` };
}

/** What GoTrue's /user checks: our signature and kid, not expired. Returns the claims, or null. */
async function verified(authorization: string | null): Promise<Record<string, unknown> | null> {
  const [header, payload, signature] = (authorization?.replace(/^Bearer /, "") ?? "").split(".");
  if (!header || !payload || !signature) return null;
  try {
    const { kid } = JSON.parse(Buffer.from(header, "base64url").toString()) as { kid?: unknown };
    if (kid !== KID) return null;
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      projectKey.publicKey,
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(`${header}.${payload}`),
    );
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
    return ok && typeof claims.exp === "number" && claims.exp > Date.now() / 1000 ? claims : null;
  } catch {
    return null;
  }
}

function claimsOf(authorization: string | null): Record<string, unknown> {
  const token = authorization?.replace(/^Bearer /, "") ?? "";
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface FakeSupabaseOptions {
  /** Status for official_roles reads (default 200). */
  rolesStatus?: number;
  /** Status for precincts reads (default 200). */
  precinctsStatus?: number;
  /** Replace the grant rows returned for a user. */
  rolesRows?: (sub: string) => unknown[];
  /** Play a misconfigured database whose RLS returns the grant whatever the session's aal. */
  noRls?: boolean;
  /** Sessions that were signed out or revoked: GoTrue's /user refuses their still-unexpired tokens. */
  revokedSessions?: readonly string[];
  /** Status for /auth/v1/user (default: 200 for a live session). */
  userStatus?: number;
  /** Throw (a network failure) for requests whose path matches. */
  networkFailure?: RegExp;
}

export interface FakeRequest {
  url: URL;
  method: string;
  headers: Headers;
}

/** A fetch that plays the Supabase project. `requests` records every call. */
export function fakeSupabase(options: FakeSupabaseOptions = {}) {
  const requests: FakeRequest[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    requests.push({ url, method: request.method, headers: request.headers });
    if (options.networkFailure?.test(url.pathname)) throw new TypeError("fetch failed");
    if (url.origin !== SUPABASE_URL) return new Response("unexpected host", { status: 599 });

    switch (url.pathname) {
      case "/auth/v1/.well-known/jwks.json":
        return Response.json({ keys: [publicJwk] });
      case "/auth/v1/user": {
        // getClaims falls back to this for tokens it cannot verify locally; requireRole calls it to
        // confirm the session is still live.
        if (options.userStatus && options.userStatus !== 200) {
          return Response.json({ msg: "boom" }, { status: options.userStatus });
        }
        const claims = await verified(request.headers.get("authorization"));
        if (!claims) return Response.json({ code: 403, error_code: "bad_jwt", msg: "invalid JWT" }, { status: 403 });
        if (typeof claims.session_id !== "string" || options.revokedSessions?.includes(claims.session_id)) {
          return Response.json(
            { code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" },
            { status: 403 },
          );
        }
        return Response.json({ id: claims.sub, aud: "authenticated", role: claims.role, is_anonymous: claims.is_anonymous ?? false });
      }
      case "/rest/v1/official_roles": {
        if (options.rolesStatus && options.rolesStatus !== 200) {
          return Response.json({ message: "boom" }, { status: options.rolesStatus });
        }
        const claims = claimsOf(request.headers.get("authorization"));
        const sub = String(claims.sub ?? "");
        // The migration's RLS: own row, and only from an aal2 session.
        if (!options.noRls && (claims.aal !== "aal2" || url.searchParams.get("user_id") !== `eq.${sub}`)) {
          return Response.json([]);
        }
        const rows = options.rolesRows ? options.rolesRows(sub) : GRANTS[sub] ? [GRANTS[sub]] : [];
        return Response.json(rows);
      }
      case "/rest/v1/precincts": {
        if (options.precinctsStatus && options.precinctsStatus !== 200) {
          return Response.json({ message: "boom" }, { status: options.precinctsStatus });
        }
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        const county = url.searchParams.get("county_id")?.replace(/^eq\./, "");
        const rows = PRECINCTS.filter((p) => (id === undefined || p.id === id) && (county === undefined || p.county_id === county));
        return Response.json(rows.slice(0, 1).map(({ county_id }) => ({ county_id })));
      }
      default:
        return new Response("not found", { status: 404 });
    }
  };
  return { fetch: fetchImpl as typeof fetch, requests };
}

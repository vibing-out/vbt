// Official roles and the scope each one may act on (T-20).
// Sources: docs/locked-interfaces.md § Event schema (actor_role) and § Ballot status state machine
// (the precinct batch is run at the precinct, county batches by county or state officials).
// No I/O: apps/web looks up the grant and the target's county, then asks officialMayActOn.

/** Human official roles. The machine and simulator actor roles never sign in. */
export const OFFICIAL_ROLES = Object.freeze(["poll_worker", "county", "state"] as const);

export type OfficialRole = (typeof OFFICIAL_ROLES)[number];

/** One official's grant, as stored in official_roles (scope + scope_id, the T-04 batch scope shape). */
export type OfficialGrant =
  | { readonly role: "poll_worker"; readonly scope: "precinct"; readonly scopeId: string }
  | { readonly role: "county"; readonly scope: "county"; readonly scopeId: string }
  | { readonly role: "state"; readonly scope: null; readonly scopeId: null };

/** What an official endpoint acts on: one precinct or one county. */
export type OfficialTarget =
  | { readonly scope: "precinct"; readonly id: string }
  | { readonly scope: "county"; readonly id: string };

const ROLE_SET: ReadonlySet<string> = new Set<string>(OFFICIAL_ROLES);

/** Runtime guard for values arriving from outside the type system. */
export function isOfficialRole(value: unknown): value is OfficialRole {
  return typeof value === "string" && ROLE_SET.has(value);
}

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/**
 * Validates a raw official_roles row ({ role, scope, scope_id }). Returns null for anything that is not
 * exactly one of the three grant shapes, so a malformed row never authorizes anything.
 */
export function toOfficialGrant(row: unknown): OfficialGrant | null {
  if (typeof row !== "object" || row === null) return null;
  const { role, scope, scope_id: scopeId } = row as Record<string, unknown>;
  if (role === "poll_worker" && scope === "precinct" && nonEmpty(scopeId)) return { role, scope, scopeId };
  if (role === "county" && scope === "county" && nonEmpty(scopeId)) return { role, scope, scopeId };
  if (role === "state" && scope === null && scopeId === null) return { role, scope, scopeId };
  return null;
}

/**
 * May this official act on the target?
 *
 * `targetCountyId` is the county the target belongs to, looked up by the caller: for a precinct, its
 * precincts.county_id; for a county, the county id itself when at least one precinct is in it. Null
 * means the target is unknown, and an unknown target is denied for every role.
 *
 * - poll_worker: only its own precinct; never a county-level target.
 * - county: its county, and any precinct in that county.
 * - state: any known precinct or county.
 */
export function officialMayActOn(grant: OfficialGrant, target: OfficialTarget, targetCountyId: string | null): boolean {
  if (targetCountyId === null) return false;
  switch (grant.role) {
    case "poll_worker":
      return target.scope === "precinct" && target.id === grant.scopeId;
    case "county":
      return targetCountyId === grant.scopeId && (target.scope === "precinct" || target.id === grant.scopeId);
    case "state":
      return true;
  }
}

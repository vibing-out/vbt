import type { OfficialTarget } from "@vbt/domain";
import type { Official } from "../../lib/require-role";

/** The page's target: ?precinct= or ?county= when given, else the official's own scope (none for state). */
export function pageTarget(
  query: Record<string, string | string[] | undefined>,
  official: Pick<Official, "scope" | "scopeId"> | null,
): OfficialTarget | null {
  const one = (value: string | string[] | undefined) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
  const precinct = one(query.precinct);
  const county = one(query.county);
  if (precinct && !county) return { scope: "precinct", id: precinct };
  if (county && !precinct) return { scope: "county", id: county };
  if (!precinct && !county && official?.scope && official.scopeId) return { scope: official.scope, id: official.scopeId };
  return null;
}

import "server-only";

import type { OfficialRole, OfficialTarget } from "@vbt/domain";
import { type Official, requireRole, type RequireRoleDeps } from "./require-role";

// The re-check every /official page runs on the server before it reads anything (T-09). proxy.ts already
// answers 403 for these paths; Next's guidance is not to rely on the proxy alone. A page reads the session
// from its @supabase/ssr cookies (a browser navigation sends no Authorization header) and goes through the
// same requireRole gate as the API: aal2, a live session, one of `roles`, and `target` in scope.
// Returns the official, or null: the page must then render nothing but the refusal.
export async function requireOfficialPage(
  roles: readonly OfficialRole[],
  target?: OfficialTarget,
  deps: RequireRoleDeps = {},
): Promise<Official | null> {
  const result = await requireRole(new Request("https://official.invalid/"), roles, target, deps);
  return result.ok ? result.official : null;
}

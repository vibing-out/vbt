import { OFFICIAL_ROLES } from "@vbt/domain";
import { requireOfficialPage } from "../../lib/page-guard";
import { Forbidden, OfficialNav } from "./ui";

// Official home (T-09): where /login lands. Links to the official's own precinct or county view.
// Per request: the session decides what renders, so this page is never prerendered.
export const dynamic = "force-dynamic";

export default async function OfficialHome() {
  const official = await requireOfficialPage(OFFICIAL_ROLES);
  if (!official) return <Forbidden />;

  const home = official.scope ? `/official/${official.scope}/${encodeURIComponent(official.scopeId)}` : null;
  return (
    <main>
      <h1>Official tools</h1>
      <p>
        Signed in as {official.role.replace("_", " ")}
        {official.scopeId ? ` for ${official.scope} ${official.scopeId}` : " (statewide)"}.
      </p>
      {home ? (
        <p>
          <a href={home}>Open your {official.scope} view</a>
        </p>
      ) : (
        <p>Open /official/county/&lt;county id&gt; or /official/precinct/&lt;precinct id&gt;.</p>
      )}
      <OfficialNav />
    </main>
  );
}

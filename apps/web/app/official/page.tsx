import { OFFICIAL_ROLES } from "@vbt/domain";
import { Button } from "@vbt/ui/components/button";
import { PlainBadge } from "@vbt/ui/components/status-badge";
import { requireOfficialPage } from "../../lib/page-guard";
import { homePath, OfficialShell, Section } from "./shell";
import { Forbidden } from "./ui";

// Official home (T-09): where /login lands. Links to the official's own precinct or county view.
// Per request: the session decides what renders, so this page is never prerendered.
export const dynamic = "force-dynamic";

export default async function OfficialHome() {
  const official = await requireOfficialPage(OFFICIAL_ROLES);
  if (!official) return <Forbidden />;

  const home = homePath(official);
  return (
    <OfficialShell
      title="Official tools"
      home={home}
      description={
        <>
          Signed in as {official.role.replace("_", " ")}
          {official.scopeId ? ` for ${official.scope} ${official.scopeId}` : " (statewide)"}.
        </>
      }
    >
      <div className="flex flex-wrap gap-2">
        <PlainBadge mode="admin">Signed in with MFA</PlainBadge>
      </div>
      {home ? (
        <Section title={`Your ${official.scope}`} description="Ballots by status, batches and certification.">
          <div>
            <Button asChild mode="admin">
              <a href={home}>Open your {official.scope} view</a>
            </Button>
          </div>
        </Section>
      ) : (
        <Section title="Statewide" description="Open any county or precinct.">
          <div>
            <Button asChild mode="admin" variant="secondary">
              <a href="/official/mismatches">Choose a county or precinct</a>
            </Button>
          </div>
        </Section>
      )}
    </OfficialShell>
  );
}

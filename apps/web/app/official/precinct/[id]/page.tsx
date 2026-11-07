import { OFFICIAL_ROLES } from "@vbt/domain";
import { Button } from "@vbt/ui/components/button";
import { requireOfficialPage } from "../../../../lib/page-guard";
import { serviceDb } from "../../../../lib/official-db";
import { BatchForm } from "../../batch-form";
import { homePath, OfficialShell } from "../../shell";
import { Forbidden, StatusCounts } from "../../ui";

// Precinct view (T-09): ballots by status, and the one-action precinct tally (CAST -> TALLIED_PRECINCT),
// gated by C1 (machine logs) and C2 (precinct totals). Poll workers see their own precinct; county and state
// officials any precinct in scope.
// Per request: the session decides what renders, so this page is never prerendered.
export const dynamic = "force-dynamic";

export default async function PrecinctPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const official = await requireOfficialPage(OFFICIAL_ROLES, { scope: "precinct", id });
  if (!official) return <Forbidden />;

  const home = homePath(official);
  const counts = await serviceDb().statusCounts("precinct", id);
  return (
    <OfficialShell title={`Precinct ${id}`} home={home} description="Ballots by status and the precinct tally.">
      <StatusCounts counts={counts} />
      <BatchForm
        scope="precinct"
        scopeId={id}
        from="CAST"
        to="TALLIED_PRECINCT"
        action="Tally the whole precinct"
        count={counts.CAST ?? 0}
      />
      <div>
        <Button asChild mode="admin" variant="secondary">
          <a href={`/official/mismatches?precinct=${encodeURIComponent(id)}`}>Mismatches in this precinct</a>
        </Button>
      </div>
    </OfficialShell>
  );
}

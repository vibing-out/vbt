import { requireOfficialPage } from "../../../../lib/page-guard";
import { serviceDb } from "../../../../lib/official-db";
import { BatchForm } from "../../batch-form";
import { Forbidden, OfficialNav, StatusCounts } from "../../ui";

// County view (T-09): ballots by status, the election-night report (TALLIED_PRECINCT -> REPORTED_UNOFFICIAL,
// gated by C3) and certification (REPORTED_UNOFFICIAL -> CERTIFIED, gated by C4). County and state officials.
const ROLES = ["county", "state"] as const;

// Per request: the session decides what renders, so this page is never prerendered.
export const dynamic = "force-dynamic";

export default async function CountyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const official = await requireOfficialPage(ROLES, { scope: "county", id });
  if (!official) return <Forbidden />;

  const counts = await serviceDb().statusCounts("county", id);
  return (
    <main>
      <h1>County {id}</h1>
      <OfficialNav />
      <StatusCounts counts={counts} />
      <BatchForm
        scope="county"
        scopeId={id}
        from="TALLIED_PRECINCT"
        to="REPORTED_UNOFFICIAL"
        action="Report election-night results"
        count={counts.TALLIED_PRECINCT ?? 0}
      />
      <BatchForm
        scope="county"
        scopeId={id}
        from="REPORTED_UNOFFICIAL"
        to="CERTIFIED"
        action="Certify the county"
        count={counts.REPORTED_UNOFFICIAL ?? 0}
      />
      <p>
        <a href={`/official/challenges?county=${encodeURIComponent(id)}`}>Challenge queue</a> ·{" "}
        <a href={`/official/mismatches?county=${encodeURIComponent(id)}`}>Mismatch report</a>
      </p>
    </main>
  );
}

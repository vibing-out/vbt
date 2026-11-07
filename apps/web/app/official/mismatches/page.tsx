import { OFFICIAL_ROLES } from "@vbt/domain";
import { mismatchReport } from "../../../lib/mismatches";
import { requireOfficialPage } from "../../../lib/page-guard";
import { serviceDb } from "../../../lib/official-db";
import { pageTarget } from "../scope";
import { Forbidden, OfficialNav } from "../ui";

// Mismatch report (T-09): mismatched or challenged ballots in a precinct or county, with the check that
// failed and the date (never the time). Officials only; ?precinct=<id> or ?county=<id>, else their own scope.
// Per request: the session decides what renders, so this page is never prerendered.
export const dynamic = "force-dynamic";

export default async function MismatchesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const requested = pageTarget(query, null);
  const official = await requireOfficialPage(OFFICIAL_ROLES, requested ?? undefined);
  if (!official) return <Forbidden />;

  const target = requested ?? pageTarget({}, official);
  if (!target) {
    return (
      <main>
        <h1>Mismatch report</h1>
        <OfficialNav />
        <p>Add ?precinct=&lt;id&gt; or ?county=&lt;id&gt; to choose a scope.</p>
      </main>
    );
  }
  const rows = await mismatchReport(target, serviceDb());
  return (
    <main>
      <h1>
        Mismatch report: {target.scope} {target.id}
      </h1>
      <OfficialNav />
      <p>
        <a href={`/api/reports/mismatches?${target.scope}=${encodeURIComponent(target.id)}`}>Download as JSON</a>
      </p>
      {rows.length === 0 ? (
        <p>No mismatches.</p>
      ) : (
        <table data-testid="mismatch-report">
          <thead>
            <tr>
              <th scope="col">Tracking code</th>
              <th scope="col">Precinct</th>
              <th scope="col">Machine</th>
              <th scope="col">Status</th>
              <th scope="col">Check</th>
              <th scope="col">Date detected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ballot_id}>
                <td>{r.tracking_code}</td>
                <td>{r.precinct_id}</td>
                <td>{r.machine_id}</td>
                <td>{r.current_status}</td>
                <td>{r.reason ?? ""}</td>
                <td>{r.detected_on ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

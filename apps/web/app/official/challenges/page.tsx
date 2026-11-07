import { requireOfficialPage } from "../../../lib/page-guard";
import { serviceDb } from "../../../lib/official-db";
import { pageTarget } from "../scope";
import { Forbidden, OfficialNav } from "../ui";
import { ResolveForm } from "./resolve-form";

// Challenge queue (T-09): challenged ballots in a county, each resolved as accepted or rejected (reason
// required). County officials see their county; the state official adds ?county=<id>.
const ROLES = ["county", "state"] as const;

// Per request: the session decides what renders, so this page is never prerendered.
export const dynamic = "force-dynamic";

export default async function ChallengesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const requested = pageTarget(query, null);
  const official = await requireOfficialPage(ROLES, requested ?? undefined);
  if (!official) return <Forbidden />;

  const target = requested ?? pageTarget({}, official);
  if (!target || target.scope !== "county") {
    return (
      <main>
        <h1>Challenge queue</h1>
        <OfficialNav />
        <p>Add ?county=&lt;county id&gt; to choose a county.</p>
      </main>
    );
  }
  const rows = (await serviceDb().mismatches(target.scope, target.id)).filter((r) => r.current_status === "CHALLENGED");
  return (
    <main>
      <h1>Challenge queue: county {target.id}</h1>
      <OfficialNav />
      {rows.length === 0 ? (
        <p>No challenged ballots.</p>
      ) : (
        <table data-testid="challenge-queue">
          <thead>
            <tr>
              <th scope="col">Tracking code</th>
              <th scope="col">Precinct</th>
              <th scope="col">Why</th>
              <th scope="col">Resolve</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ballot_id}>
                <td>{r.tracking_code}</td>
                <td>{r.precinct_id}</td>
                <td>{r.reason ?? "Challenged"}</td>
                <td>
                  <ResolveForm ballotId={r.ballot_id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

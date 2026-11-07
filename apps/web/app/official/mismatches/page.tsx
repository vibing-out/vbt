import { OFFICIAL_ROLES } from "@vbt/domain";
import { Button } from "@vbt/ui/components/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vbt/ui/components/table";
import { mismatchReport } from "../../../lib/mismatches";
import { requireOfficialPage } from "../../../lib/page-guard";
import { serviceDb } from "../../../lib/official-db";
import { pageTarget } from "../scope";
import { homePath, OfficialShell, Section } from "../shell";
import { Forbidden, ScopePicker, StatusCell } from "../ui";

// Mismatch report (T-09): mismatched or challenged ballots in a precinct or county, with the check that
// failed and the date (never the time). Officials only; ?precinct=<id> or ?county=<id>, else their own scope.
// Per request: the session decides what renders, so this page is never prerendered.
export const dynamic = "force-dynamic";

export default async function MismatchesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const requested = pageTarget(query, null);
  const official = await requireOfficialPage(OFFICIAL_ROLES, requested ?? undefined);
  if (!official) return <Forbidden />;

  const home = homePath(official);
  const target = requested ?? pageTarget({}, official);
  if (!target) {
    return (
      <OfficialShell title="Mismatch report" home={home} description="Ballots whose machine record did not match, by county or precinct.">
        <ScopePicker action="/official/mismatches" precinct />
      </OfficialShell>
    );
  }
  const rows = await mismatchReport(target, serviceDb());
  return (
    <OfficialShell
      title={`Mismatch report: ${target.scope} ${target.id}`}
      home={home}
      description={`${rows.length} ${rows.length === 1 ? "ballot" : "ballots"} flagged. Dates only, never a time of day.`}
    >
      <div className="flex flex-wrap gap-2">
        <Button asChild mode="admin" variant="secondary">
          <a href={`/api/reports/mismatches?${target.scope}=${encodeURIComponent(target.id)}`}>Download as JSON</a>
        </Button>
        {target.scope === "county" ? (
          <Button asChild mode="admin" variant="secondary">
            <a href={`/official/challenges?county=${encodeURIComponent(target.id)}`}>Open the challenge queue</a>
          </Button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <Section title="No mismatches" description="Every ballot in this scope matched its machine record." />
      ) : (
        <Table data-testid="mismatch-report">
          <TableHeader>
            <TableRow>
              <TableHead>Tracking code</TableHead>
              <TableHead>Precinct</TableHead>
              <TableHead>Machine</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Check</TableHead>
              <TableHead>Date detected</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.ballot_id}>
                <TableCell className="font-mono text-code whitespace-nowrap">{r.tracking_code}</TableCell>
                <TableCell>{r.precinct_id}</TableCell>
                <TableCell>{r.machine_id}</TableCell>
                <TableCell>
                  <StatusCell status={r.current_status} />
                </TableCell>
                <TableCell>{r.reason ?? ""}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{r.detected_on ?? ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </OfficialShell>
  );
}

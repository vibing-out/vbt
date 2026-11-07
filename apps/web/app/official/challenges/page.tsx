import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vbt/ui/components/table";
import { requireOfficialPage } from "../../../lib/page-guard";
import { serviceDb } from "../../../lib/official-db";
import { pageTarget } from "../scope";
import { homePath, OfficialShell, Section } from "../shell";
import { Forbidden, ScopePicker } from "../ui";
import { ResolveForm } from "./resolve-form";

// Challenge queue (T-09): challenged ballots in a county, each resolved as accepted or rejected (reason
// required). County officials see their county; the state official picks one.
const ROLES = ["county", "state"] as const;

// Per request: the session decides what renders, so this page is never prerendered.
export const dynamic = "force-dynamic";

export default async function ChallengesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const requested = pageTarget(query, null);
  const official = await requireOfficialPage(ROLES, requested ?? undefined);
  if (!official) return <Forbidden />;

  const home = homePath(official);
  const target = requested ?? pageTarget({}, official);
  if (!target || target.scope !== "county") {
    return (
      <OfficialShell title="Challenge queue" home={home} description="Challenged ballots, resolved one at a time.">
        <ScopePicker action="/official/challenges" />
      </OfficialShell>
    );
  }
  const rows = (await serviceDb().mismatches(target.scope, target.id)).filter((r) => r.current_status === "CHALLENGED");
  return (
    <OfficialShell
      title={`Challenge queue: county ${target.id}`}
      home={home}
      description="Accept returns a ballot to the status it held before. Reject discards it, and the reason is shown to the voter."
    >
      {rows.length === 0 ? (
        <Section title="No challenged ballots" description="Nothing is waiting for a decision in this county." />
      ) : (
        <Table data-testid="challenge-queue">
          <TableHeader>
            <TableRow>
              <TableHead>Tracking code</TableHead>
              <TableHead>Precinct</TableHead>
              <TableHead>Why</TableHead>
              <TableHead>Resolve</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.ballot_id}>
                <TableCell className="font-mono text-code whitespace-nowrap">{r.tracking_code}</TableCell>
                <TableCell>{r.precinct_id}</TableCell>
                <TableCell>{r.reason ?? "Challenged"}</TableCell>
                <TableCell className="min-w-80">
                  <ResolveForm ballotId={r.ballot_id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </OfficialShell>
  );
}

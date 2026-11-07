import { BALLOT_STATUSES, isBallotStatus, publicLabel } from "@vbt/domain";
import { Button } from "@vbt/ui/components/button";
import { Input } from "@vbt/ui/components/input";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@vbt/ui/components/table";
import { StatusBadge } from "@vbt/ui/components/status-badge";
import { CenteredCard, Section } from "./shell";

// Shared pieces of the official pages (T-09), in @vbt/ui's admin mode.

export function Forbidden() {
  return (
    <CenteredCard
      testId="forbidden"
      title="Forbidden"
      description="Sign in as an official with multi-factor authentication to see this page."
    >
      <Button asChild mode="admin">
        <a href="/login">Sign in</a>
      </Button>
    </CenteredCard>
  );
}

export function StatusCounts({ counts }: { counts: Record<string, number> }) {
  return (
    <Table data-testid="status-counts">
      <TableCaption>Ballots by status</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Public label</TableHead>
          <TableHead numeric>Ballots</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {BALLOT_STATUSES.map((status) => (
          <TableRow key={status}>
            <TableHead scope="row" className="normal-case">
              <StatusBadge status={status} mode="admin" label={status} />
            </TableHead>
            <TableCell>{publicLabel(status)}</TableCell>
            <TableCell numeric>{counts[status] ?? 0}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** A ballot's status in a table cell: the admin badge, or the raw value if it is not a known status. */
export function StatusCell({ status }: { status: string }) {
  return isBallotStatus(status) ? <StatusBadge status={status} mode="admin" /> : <>{status}</>;
}

/** Picks a scope with a plain GET form, for officials (the state official) with no scope of their own. */
export function ScopePicker({ action, precinct = false }: { action: string; precinct?: boolean }) {
  return (
    <Section
      title="Choose a scope"
      description={precinct ? "Enter a county id, or a precinct id, to open its report." : "Enter a county id to open its queue."}
    >
      <form method="get" action={action} className="flex flex-wrap items-end gap-3" data-testid="scope-county">
        <Input id="scope-county" name="county" label="County id" mode="admin" placeholder="SCALE-DEMO" required className="min-w-56" />
        <Button type="submit" mode="admin">
          Open county
        </Button>
      </form>
      {precinct ? (
        <form method="get" action={action} className="flex flex-wrap items-end gap-3" data-testid="scope-precinct">
          <Input id="scope-precinct" name="precinct" label="Precinct id" mode="admin" placeholder="SCALE-DEMO-001" required className="min-w-56" />
          <Button type="submit" mode="admin" variant="secondary">
            Open precinct
          </Button>
        </form>
      ) : null}
    </Section>
  );
}

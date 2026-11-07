// The /record page body (T-08b): every published stage record by county and stage, each with its
// JSON download (the exact GET /api/record/{scope}/{stage} URL), Merkle root, totals and signature,
// and a "Check it yourself" section. Dates only, never a time or a sequence. Rendered on the server.
import { publicLabel } from "@vbt/domain";
import { Card, CardDescription, CardTitle } from "@vbt/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vbt/ui/components/table";
import {
  MERKLE_ROOT_HINT,
  NO_RECORDS,
  RECORD_FORMAT_URL,
  RECORD_INTRO,
  RECORDS_UNAVAILABLE,
  SIGNATURE_HINT,
  VERIFIER_URL,
} from "../../lib/record/copy";
import type { CountyRecords } from "../../lib/record/group";
import { recordAnchor, recordApiUrl, recordFileName } from "../../lib/record/links";
import type { RecordSummary } from "../../lib/record/types";
import { formatDisplayDate } from "../../lib/track/dates";

export type RecordListState = { kind: "ready"; counties: CountyRecords[] } | { kind: "unavailable" };

const LINK = "text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2";

export function RecordListView({ state }: { state: RecordListState }): React.JSX.Element {
  return (
    <>
      <Card variant="hero">
        <p className="text-label uppercase text-on-inverse-muted">Public election record</p>
        <h1 className="text-display">Published records</h1>
        <CardDescription>{RECORD_INTRO}</CardDescription>
      </Card>

      {state.kind === "unavailable" && (
        <p role="alert" data-testid="records-unavailable" className="text-body-lg text-ink">
          {RECORDS_UNAVAILABLE}
        </p>
      )}
      {state.kind === "ready" && state.counties.length === 0 && (
        <p data-testid="no-records" className="text-body-lg text-ink">
          {NO_RECORDS}
        </p>
      )}
      {state.kind === "ready" &&
        state.counties.map((county) => (
          <section
            key={county.countyId}
            aria-labelledby={`county-${county.countyId}`}
            data-testid="county-records"
            data-county={county.countyId}
            className="flex flex-col gap-4"
          >
            <h2 id={`county-${county.countyId}`} className="text-title text-ink">
              County {county.countyId}
            </h2>
            {county.records.map((record) => (
              <RecordEntry key={`${record.scope_id}-${record.stage}`} record={record} />
            ))}
          </section>
        ))}

      <CheckItYourself />
    </>
  );
}

function RecordEntry({ record }: { record: RecordSummary }) {
  const published = formatDisplayDate(record.published_on);
  const contests = Object.entries(record.totals);
  return (
    <Card
      id={recordAnchor(record.scope_id, record.stage)}
      data-testid="record-entry"
      data-scope-id={record.scope_id}
      data-stage={record.stage}
      aria-label={`${publicLabel(record.stage)}, ${record.scope} ${record.scope_id}`}
      className="scroll-mt-4"
    >
      <div className="flex flex-col gap-1">
        <CardTitle>{publicLabel(record.stage)}</CardTitle>
        <p className="text-body text-ink">
          {record.scope === "precinct" ? "Precinct" : "County"} {record.scope_id}
          {" · "}
          {record.ballot_count} {record.ballot_count === 1 ? "ballot" : "ballots"}
        </p>
        {published && <p className="text-small text-ink-muted">Published {published}</p>}
      </div>

      <dl className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-label uppercase text-ink-muted">Merkle root</dt>
          <dd data-testid="merkle-root" className="break-all font-mono text-small text-ink">{record.merkle_root}</dd>
          <dd className="text-small text-ink-muted">{MERKLE_ROOT_HINT}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-label uppercase text-ink-muted">Signature</dt>
          <dd data-testid="signature" className="break-all font-mono text-small text-ink">{record.signature}</dd>
          <dd className="text-small text-ink-muted">{SIGNATURE_HINT}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2">
        <h4 className="text-label uppercase text-ink-muted">Totals</h4>
        {contests.length === 0 ? (
          <p data-testid="totals" className="text-body text-ink">No totals in this record.</p>
        ) : (
          <Table mode="voter" data-testid="totals">
            <TableHeader>
              <TableRow>
                <TableHead>Contest</TableHead>
                <TableHead>Choice</TableHead>
                <TableHead numeric>Votes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contests.flatMap(([contest, choices]) =>
                Object.entries(choices).map(([choice, votes]) => (
                  <TableRow key={`${contest}-${choice}`}>
                    <TableCell className="font-mono">{contest}</TableCell>
                    <TableCell className="font-mono">{choice}</TableCell>
                    <TableCell numeric>{votes}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <a
        href={recordApiUrl(record.scope_id, record.stage)}
        download={recordFileName(record.scope_id, record.stage)}
        data-testid="record-download"
        className={`min-h-11 self-start py-2 text-body font-semibold ${LINK}`}
      >
        Download the record (JSON)
      </a>
    </Card>
  );
}

function CheckItYourself() {
  return (
    <Card aria-labelledby="check-it-yourself" data-testid="check-it-yourself">
      <h2 id="check-it-yourself" className="text-title">Check it yourself</h2>
      <p className="text-body text-ink">
        You don&apos;t have to trust this website. Download any record above and check it with the independent verifier.
        It recomputes the Merkle root from the listed fingerprints, checks the signature with the election office&apos;s
        public key and adds up the totals.
      </p>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-body text-ink">
        <li>
          <a href={RECORD_FORMAT_URL} className={LINK}>
            How a record is laid out
          </a>{" "}
          (<code className="font-mono text-small">docs/record-format.md</code>)
        </li>
        <li>
          <a href={VERIFIER_URL} className={LINK}>
            The independent verifier
          </a>{" "}
          (<code className="font-mono text-small">tools/verifier</code>)
        </li>
      </ul>
    </Card>
  );
}

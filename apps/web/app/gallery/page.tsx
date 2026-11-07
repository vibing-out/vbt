import { Button } from "@vbt/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@vbt/ui/components/card";
import { CopyCode } from "@vbt/ui/components/copy-code";
import { Input } from "@vbt/ui/components/input";
import { Receipt } from "@vbt/ui/components/receipt";
import { StageTimeline, type StageEntry, type StageTimelineProps } from "@vbt/ui/components/stage-timeline";
import { PlainBadge, StatusBadge } from "@vbt/ui/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vbt/ui/components/table";
import type { Mode } from "@vbt/ui/lib/mode";
import { BALLOT_STATUSES, type BallotStatus } from "@vbt/ui/status";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { QrDemo } from "./qr-demo";

// Every @vbt/ui component in voter and admin mode, with fixed, made-up sample data.
// No real election data, no flags; kept out of search results.
export const metadata: Metadata = {
  title: "VBT component gallery",
  robots: { index: false, follow: false },
};

const SAMPLE = {
  county: "Marion County",
  election: "General Election",
  electionDate: "Nov 3, 2026",
  precinct: "Precinct 12",
  code: "RIVER-MAPLE-7Q4K-HAWK",
  trackUrl: "vote.marion.in.gov/track",
  phone: "1-800-555-0100",
  phoneCode: "4821 9937 06",
  /** A date, never a time of day: nothing beside a tracking code may reveal casting order. */
  updated: "Nov 3",
} as const;

const TONIGHT: StageEntry[] = [
  { stage: "CAST", state: "done", date: "Nov 3" },
  { stage: "TALLIED_PRECINCT", state: "done", date: "Nov 3" },
  { stage: "REPORTED_UNOFFICIAL", state: "current", date: "Nov 3" },
  { stage: "CERTIFIED", state: "upcoming", expected: "Nov 18" },
];

const COUNTED: StageEntry[] = [
  { stage: "CAST", state: "done", date: "Nov 3" },
  { stage: "TALLIED_PRECINCT", state: "current", date: "Nov 3" },
];

const NEXT_STEP = "Certification is usually within two weeks.";

/** The three exceptions and loading, on a light card (StageTimeline README, Exceptions and States). */
const EXCEPTIONS: { title: string; props: StageTimelineProps }[] = [
  {
    title: "Under review",
    props: { stages: COUNTED, offPath: { status: "CHALLENGED", reason: "The paper and machine records differ." } },
  },
  {
    title: "Not counted",
    props: { stages: COUNTED, offPath: { status: "DISCARDED", reason: "arrived after the deadline", date: "Nov 5" } },
  },
  {
    title: "Spoiled",
    props: {
      stages: [],
      offPath: { status: "SPOILED", replacement: { code: "OAK-FERN-2M8P-WREN", href: "#replacement" } },
    },
  },
  { title: "Loading", props: { stages: [], loading: true } },
];

function SampleQr() {
  return (
    <div
      role="img"
      aria-label="Sample QR code"
      className="grid size-32 place-items-center rounded-sm border-2 border-dashed border-current text-label uppercase"
    >
      Sample QR
    </div>
  );
}

function Item({ title, children, mode }: { title: string; children: ReactNode; mode: Mode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className={mode === "admin" ? "text-heading" : "text-title"}>{title}</h3>
      {children}
    </div>
  );
}

function Badges({ mode }: { mode: Mode }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {BALLOT_STATUSES.map((status) => (
        <StatusBadge key={status} status={status} mode={mode} />
      ))}
      {mode === "admin" ? (
        <>
          <PlainBadge mode="admin">Uploaded Nov 3</PlainBadge>
          <PlainBadge mode="admin">Signed in with MFA</PlainBadge>
        </>
      ) : null}
    </div>
  );
}

function Timelines({ mode }: { mode: Mode }) {
  return (
    <div className="flex flex-col gap-6">
      {/* The tracker hero card: headline, then the timeline, then the code. */}
      <Card variant="hero" mode={mode}>
        <p className="text-label uppercase text-on-inverse-muted">
          {SAMPLE.county} · {SAMPLE.precinct} · Updated {SAMPLE.updated}
        </p>
        <h4 className={mode === "admin" ? "text-heading" : "text-display"}>
          Your ballot is in Marion County&apos;s election-night results
        </h4>
        <StageTimeline surface="hero" mode={mode} stages={TONIGHT} />
        <p className={mode === "admin" ? "text-body" : "text-body-lg"}>{NEXT_STEP}</p>
        <CopyCode code={SAMPLE.code} mode={mode} surface="inverse" />
      </Card>
      <Card mode={mode}>
        <StageTimeline mode={mode} stages={TONIGHT} />
      </Card>
      {EXCEPTIONS.map(({ title, props }) => (
        <Card key={title} mode={mode}>
          <p className="text-label uppercase text-ink-muted">{title}</p>
          <StageTimeline {...props} mode={mode} />
        </Card>
      ))}
    </div>
  );
}

function Cards({ mode }: { mode: Mode }) {
  return (
    <div className="flex flex-col gap-6">
      <Card mode={mode}>
        <CardHeader>
          <CardTitle mode={mode} level={3}>{mode === "admin" ? "Precinct 12 batch" : "Your ballot is safe"}</CardTitle>
          <CardDescription mode={mode}>
            {mode === "admin"
              ? "This publishes a signed record for every ballot in the batch."
              : "The encrypted ballot has not changed since you cast it."}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="secondary" mode={mode}>
            {mode === "admin" ? "Review batch" : "See the public record"}
          </Button>
        </CardFooter>
      </Card>
      <Card variant="hero" mode={mode}>
        <CardHeader>
          <CardTitle mode={mode} level={3}>{mode === "admin" ? "3 precincts selected" : "Track your ballot"}</CardTitle>
          <CardDescription mode={mode}>
            {mode === "admin"
              ? "Counting them moves 3,412 ballots to Counted at precinct."
              : "Enter the code from your receipt to see where your ballot is."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div>
            <Button mode={mode} inverse>
              {mode === "admin" ? "Count 3 precincts" : "Track my ballot"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function VoterTable() {
  return (
    <Table mode="voter">
      <TableHeader>
        <TableRow>
          <TableHead>Stage</TableHead>
          <TableHead>Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {TONIGHT.filter((s) => s.state !== "upcoming").map((s) => (
          <TableRow key={s.stage} selected={s.state === "current"}>
            <TableCell>
              <StatusBadge status={s.stage} mode="voter" />
            </TableCell>
            <TableCell>{s.date}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const PRECINCTS: { name: string; ballots: number; status: BallotStatus; updated: string; selected?: boolean }[] = [
  { name: "Precinct 12", ballots: 1204, status: "REPORTED_UNOFFICIAL", updated: "Nov 3", selected: true },
  { name: "Precinct 14", ballots: 988, status: "TALLIED_PRECINCT", updated: "Nov 3", selected: true },
  { name: "Precinct 15", ballots: 1530, status: "CERTIFIED", updated: "Nov 17" },
  { name: "Precinct 21", ballots: 3, status: "CHALLENGED", updated: "Nov 4" },
  { name: "Precinct 22", ballots: 1, status: "DISCARDED", updated: "Nov 5" },
  { name: "Precinct 30", ballots: 2, status: "SPOILED", updated: "Nov 3" },
  { name: "Precinct 31", ballots: 742, status: "CAST", updated: "Nov 3" },
];

function AdminTable() {
  return (
    <Table mode="admin" wrapperClassName="max-h-80">
      <TableHeader>
        <TableRow>
          <TableHead>Precinct</TableHead>
          <TableHead>Stage</TableHead>
          <TableHead numeric>Ballots</TableHead>
          <TableHead numeric>Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {PRECINCTS.map((p) => (
          <TableRow key={p.name} selected={p.selected}>
            <TableCell className="whitespace-nowrap">{p.name}</TableCell>
            <TableCell>
              <StatusBadge status={p.status} mode="admin" />
            </TableCell>
            <TableCell numeric>{p.ballots.toLocaleString("en-US")}</TableCell>
            <TableCell numeric>{p.updated}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Receipts({ mode }: { mode: Mode }) {
  const common = { ...SAMPLE, mode, qr: <SampleQr /> };
  return (
    <div className={mode === "admin" ? "grid gap-6 lg:grid-cols-2" : "flex flex-col gap-6"}>
      <Receipt {...common} form="pass" status="REPORTED_UNOFFICIAL" trackHref={`/track/${SAMPLE.code}`} />
      <Receipt {...common} form="slip" phoneCode={SAMPLE.phoneCode} textNumber={SAMPLE.phone} />
    </div>
  );
}

function Section({ mode }: { mode: Mode }) {
  const voter = mode === "voter";
  return (
    <section
      data-testid={`gallery-${mode}`}
      data-mode={mode}
      aria-labelledby={`gallery-${mode}-title`}
      className={voter ? "mx-auto flex w-full max-w-140 flex-col gap-8" : "flex w-full flex-col gap-8"}
    >
      <header className="flex flex-col gap-2">
        <h2 id={`gallery-${mode}-title`} className="text-display">
          {voter ? "Voter mode" : "Admin mode"}
        </h2>
        <p className={voter ? "text-body-lg text-ink-muted" : "text-body text-ink-muted"}>
          {voter
            ? "One idea per screen, large type, targets at least 44px tall, one column up to 560px wide."
            : "Dense tables, compact labels, 16px icons and tabular numbers for every count."}
        </p>
      </header>

      <Item title="Button" mode={mode}>
        <div className="flex flex-wrap gap-3">
          <Button mode={mode}>{voter ? "Track my ballot" : "Publish batch"}</Button>
          <Button variant="secondary" mode={mode}>
            {voter ? "Scan the QR code" : "Cancel"}
          </Button>
          <Button variant="secondary" mode={mode} disabled>
            Not available
          </Button>
        </div>
      </Item>

      <Item title="Input" mode={mode}>
        <div className={voter ? "flex flex-col gap-6" : "grid gap-6 md:grid-cols-2"}>
          <Input
            id={`${mode}-code`}
            label="Tracking code"
            variant="code"
            mode={mode}
            placeholder="RIVER-MAPLE-7Q4K-HAWK"
            hint="Codes use letters A to Z and numbers 2 to 9."
          />
          <Input
            id={`${mode}-code-error`}
            label="Tracking code"
            variant="code"
            mode={mode}
            defaultValue="RIVER-MAPLE-0000"
            error="We couldn't find that code. Check it against your receipt."
          />
          {voter ? null : <Input id="admin-precinct" label="Precinct" mode="admin" defaultValue="Precinct 12" />}
        </div>
      </Item>

      <Item title="Status badge" mode={mode}>
        <Badges mode={mode} />
      </Item>

      <Item title="Stage timeline" mode={mode}>
        <Timelines mode={mode} />
      </Item>

      <Item title="Card" mode={mode}>
        <Cards mode={mode} />
      </Item>

      <Item title="Table" mode={mode}>
        {voter ? <VoterTable /> : <AdminTable />}
      </Item>

      <Item title="Receipt" mode={mode}>
        <Receipts mode={mode} />
      </Item>

      <Item title="QR scanner frame" mode={mode}>
        <div className={voter ? "" : "max-w-140"}>
          <QrDemo mode={mode} />
        </div>
      </Item>
    </section>
  );
}

export default function GalleryPage() {
  return (
    <main className="flex min-h-screen flex-col gap-12 bg-surface px-4 py-12 text-ink md:px-8">
      <header className="mx-auto flex w-full max-w-140 flex-col gap-2">
        <p className="text-label uppercase text-ink-muted">Verifiable Ballot Tracking</p>
        <h1 className="text-display">Component gallery</h1>
        <p className="text-body-lg text-ink-muted">
          Every component in voter and admin mode. The county, codes and dates are sample data.
        </p>
      </header>
      <Section mode="voter" />
      <Section mode="admin" />
    </main>
  );
}

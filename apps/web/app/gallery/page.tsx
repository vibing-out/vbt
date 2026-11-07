import { Button } from "@vbt/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@vbt/ui/components/card";
import { Input } from "@vbt/ui/components/input";
import { Receipt } from "@vbt/ui/components/receipt";
import { StageTimeline, type StageEntry } from "@vbt/ui/components/stage-timeline";
import { PlainBadge, StatusBadge, type StatusBadgeProps } from "@vbt/ui/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@vbt/ui/components/table";
import type { Mode } from "@vbt/ui/lib/mode";
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
  phoneCode: "7482-6619-0354-2817",
  updatedAt: "9:42 PM",
} as const;

const TONIGHT: StageEntry[] = [
  { stage: "CAST", state: "done", date: "Nov 3" },
  { stage: "TALLIED_PRECINCT", state: "done", date: "Nov 3" },
  { stage: "REPORTED_UNOFFICIAL", state: "current", date: "Nov 3" },
];

const COUNTED: StageEntry[] = [
  { stage: "CAST", state: "done", date: "Nov 3" },
  { stage: "TALLIED_PRECINCT", state: "current", date: "Nov 3" },
];

const CERTIFIED: StageEntry[] = [
  { stage: "CAST", state: "done", date: "Nov 3" },
  { stage: "TALLIED_PRECINCT", state: "done", date: "Nov 3" },
  { stage: "REPORTED_UNOFFICIAL", state: "done", date: "Nov 3" },
  { stage: "CERTIFIED", state: "current", date: "Nov 17" },
];

const NEXT_STEP = "Counties certify up to about 2 weeks after Election Day.";

const ALL_STATUSES: StatusBadgeProps[] = [
  { status: "CAST", detail: "Nov 3" },
  { status: "TALLIED_PRECINCT", detail: "Nov 3" },
  { status: "REPORTED_UNOFFICIAL", state: "current" },
  { status: "CERTIFIED" },
  { status: "CHALLENGED", reason: "signature check" },
  { status: "DISCARDED", reason: "arrived after the deadline" },
  { status: "SPOILED" },
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
      {ALL_STATUSES.map((props) => (
        <StatusBadge key={props.status} {...props} mode={mode} />
      ))}
      {mode === "admin" ? (
        <>
          <StatusBadge status="CERTIFIED" state="pending" mode="admin" />
          <PlainBadge mode="admin">Uploaded tonight</PlainBadge>
          <PlainBadge mode="admin">Signed in with MFA</PlainBadge>
        </>
      ) : null}
    </div>
  );
}

function Timelines({ mode }: { mode: Mode }) {
  return (
    <div className="flex flex-col gap-6">
      <StageTimeline
        form="hero"
        mode={mode}
        stages={TONIGHT}
        justCompleted="TALLIED_PRECINCT"
        headline="Your ballot is in tonight's results"
        nextStep={NEXT_STEP}
        code={SAMPLE.code}
        county={SAMPLE.county}
        precinct={SAMPLE.precinct}
        updatedAt={SAMPLE.updatedAt}
      />
      <StageTimeline
        form="hero"
        mode={mode}
        stages={COUNTED}
        offPath={{ status: "DISCARDED", reason: "arrived after the deadline" }}
        headline="Your ballot was not counted"
        nextStep="The county election board decided this. Call the county to ask about it."
        code={SAMPLE.code}
        county={SAMPLE.county}
        precinct={SAMPLE.precinct}
        updatedAt={SAMPLE.updatedAt}
      />
      <StageTimeline form="history" mode={mode} stages={TONIGHT} nextStep={NEXT_STEP} />
      <StageTimeline form="compact" mode={mode} stages={TONIGHT} />
    </div>
  );
}

function Cards({ mode }: { mode: Mode }) {
  return (
    <div className="flex flex-col gap-6">
      <Card mode={mode}>
        <CardHeader>
          <CardTitle mode={mode}>{mode === "admin" ? "Precinct 12 batch" : "Your ballot is safe"}</CardTitle>
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
          <CardTitle mode={mode}>{mode === "admin" ? "3 precincts selected" : "Track your ballot"}</CardTitle>
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
        {TONIGHT.map((s) => (
          <TableRow key={s.stage} selected={s.state === "current"}>
            <TableCell>
              <StatusBadge
                status={s.stage}
                state={s.state === "current" ? "current" : "done"}
                mode="voter"
              />
            </TableCell>
            <TableCell>{s.date}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const PRECINCTS: {
  name: string;
  ballots: number;
  stages: StageEntry[];
  status: StatusBadgeProps;
  selected?: boolean;
}[] = [
  { name: "Precinct 12", ballots: 1204, stages: TONIGHT, status: { status: "REPORTED_UNOFFICIAL", state: "current" }, selected: true },
  { name: "Precinct 14", ballots: 988, stages: COUNTED, status: { status: "TALLIED_PRECINCT", state: "current" }, selected: true },
  { name: "Precinct 15", ballots: 1530, stages: CERTIFIED, status: { status: "CERTIFIED", state: "pending" } },
  { name: "Precinct 21", ballots: 3, stages: COUNTED, status: { status: "CHALLENGED", reason: "1 mismatch" } },
  { name: "Precinct 22", ballots: 1, stages: COUNTED, status: { status: "DISCARDED", reason: "arrived after the deadline" } },
  { name: "Precinct 30", ballots: 2, stages: [{ stage: "CAST", state: "done", date: "Nov 3" }], status: { status: "SPOILED" } },
  { name: "Precinct 31", ballots: 742, stages: [{ stage: "CAST", state: "current", date: "Nov 3" }], status: { status: "CAST", state: "current" } },
];

function AdminTable() {
  return (
    <Table mode="admin" wrapperClassName="max-h-80">
      <TableHeader>
        <TableRow>
          <TableHead>Precinct</TableHead>
          <TableHead numeric>Ballots</TableHead>
          <TableHead>Progress</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {PRECINCTS.map((p) => (
          <TableRow key={p.name} selected={p.selected}>
            <TableCell className="whitespace-nowrap">{p.name}</TableCell>
            <TableCell numeric>{p.ballots.toLocaleString("en-US")}</TableCell>
            <TableCell className="min-w-64">
              <StageTimeline form="compact" mode="admin" stages={p.stages} />
            </TableCell>
            <TableCell>
              <StatusBadge {...p.status} mode="admin" />
            </TableCell>
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
      <Receipt {...common} form="pass" />
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
          <QrDemo mode={mode} code={SAMPLE.code} />
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

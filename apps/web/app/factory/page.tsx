import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vbt/ui/components/card";
import Link from "next/link";
import { recentCorrections, type Correction } from "../../lib/context-log";
import { factoryStats, type FactoryStats } from "../../lib/factory-stats";

export const metadata = { title: "How it was built · VBT" };

// Rendered on the server and regenerated at most once a minute: judges see live numbers, and GitHub's
// unauthenticated rate limit and the context log see one read per minute, not one per visitor.
export const revalidate = 60;

const PIPELINE = [
  { step: "Ticket", note: "A GitHub issue, labeled queued" },
  { step: "Warp Foreman", note: "Dispatches the triage, spec, implement and review agents" },
  { step: "Implement", note: "Claude Code (Opus) on our Claude subscription" },
  { step: "One review", note: "A fresh Claude Code session" },
  { step: "One fix pass", note: "Then no more rounds" },
  { step: "Required checks", note: "check, context-check, CodeQL, Vercel" },
  { step: "Epic", note: "Ticket pull requests merge into epic/<n>" },
  { step: "Human approval", note: "Shawn or Austin approves the epic" },
  { step: "main", note: "Deployed to www.ballottrack.org" },
];

const COST = { before: "$4.86", after: "$0.86", measured: "Nov 7, 2026" };

function formatCount(value: number | null): string {
  return value === null ? "—" : String(value);
}

function Stat({ label, value, testId }: { label: string; value: number | null; testId: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className="text-display">{formatCount(value)}</span>
      <span className="text-small text-ink-muted">{value === null ? `${label} (unavailable)` : label}</span>
    </div>
  );
}

function Corrections({ corrections }: { corrections: Correction[] | null }): React.JSX.Element {
  if (corrections === null) return <p className="text-ink-muted">The context log is unavailable right now.</p>;
  if (corrections.length === 0) return <p className="text-ink-muted">No corrections logged yet.</p>;
  return (
    <ol className="flex flex-col gap-4">
      {corrections.map((c) => (
        <li key={c.id} className="flex flex-col gap-1 border-l-2 border-accent-mark pl-3" data-testid="correction">
          <span className="text-small text-ink-muted">
            #{c.id}
            {c.topic ? ` · ${c.topic}` : ""}
            {c.date ? ` · ${c.date}` : ""}
          </span>
          <p>
            <strong>Claim:</strong> {c.claim}
          </p>
          <p>
            <strong>Caught by:</strong> {c.caughtBy}
          </p>
          <p>
            <strong>Fix:</strong> {c.fix}
          </p>
        </li>
      ))}
    </ol>
  );
}

export default async function FactoryPage(): Promise<React.JSX.Element> {
  const [stats, corrections]: [FactoryStats, Correction[] | null] = await Promise.all([factoryStats(), recentCorrections()]);
  return (
    <div className="min-h-dvh bg-surface">
      <main data-testid="factory" className="mx-auto flex max-w-[720px] flex-col gap-6 px-4 py-8">
        <Card variant="hero">
          <p className="text-label uppercase text-on-inverse-muted">Indy Init 2026 · For the judges</p>
          <h1 className="text-display">How it was built</h1>
          <CardDescription>
            Two people and a factory of AI agents built this ballot tracker in one day. This page shows the machinery live:
            the pipeline every change went through, its numbers right now, and where the AI was wrong and got corrected.
          </CardDescription>
        </Card>

        <Card aria-labelledby="pipeline-title">
          <CardHeader>
            <CardTitle id="pipeline-title">The pipeline</CardTitle>
            <CardDescription>Every ticket takes the same path. Only a human merges into main.</CardDescription>
          </CardHeader>
          <ol className="flex flex-col gap-2" data-testid="pipeline">
            {PIPELINE.map(({ step, note }, i) => (
              <li key={step} className="flex flex-col">
                <span className="font-semibold">
                  {i > 0 ? <span aria-hidden="true" className="text-accent-text">↓ </span> : null}
                  {step}
                </span>
                <span className="text-small text-ink-muted">{note}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card aria-labelledby="numbers-title">
          <CardHeader>
            <CardTitle id="numbers-title">Live numbers</CardTitle>
            <CardDescription>
              From the public GitHub API for{" "}
              <a href="https://github.com/vibing-out/vbt" className="underline underline-offset-4">
                vibing-out/vbt
              </a>
              , refreshed every minute.
            </CardDescription>
          </CardHeader>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="tickets closed" value={stats.ticketsClosed} testId="stat-tickets-closed" />
            <Stat label="tickets open" value={stats.ticketsOpen} testId="stat-tickets-open" />
            <Stat label="pull requests merged today" value={stats.mergedToday} testId="stat-merged-today" />
            <Stat label="epics merged into main" value={stats.epicsMerged} testId="stat-epics-merged" />
          </div>
        </Card>

        <Card aria-labelledby="corrections-title">
          <CardHeader>
            <CardTitle id="corrections-title">Where the AI was corrected</CardTitle>
            <CardDescription>
              The latest corrections from the context log, the team&apos;s shared memory. Every pull request logs what the AI got
              wrong, what caught it, and the fix.
            </CardDescription>
          </CardHeader>
          <CardContent data-testid="corrections">
            <Corrections corrections={corrections} />
          </CardContent>
        </Card>

        <Card aria-labelledby="cost-title">
          <CardHeader>
            <CardTitle id="cost-title">Cost</CardTitle>
          </CardHeader>
          <CardContent data-testid="cost">
            <p>
              Warp spend per pull request fell from an average of <strong>{COST.before}</strong> to{" "}
              <strong>{COST.after}</strong> after we switched the Warp agents to Haiku. All Claude reasoning runs on our Claude
              subscription.
            </p>
            <p className="text-small text-ink-muted">Source: Warp&apos;s dashboard attribution, measured {COST.measured}.</p>
          </CardContent>
        </Card>

        <nav className="flex flex-wrap gap-4 text-small">
          <Link href="/track" className="min-h-11 py-2 underline underline-offset-4">
            Track a ballot
          </Link>
          <Link href="/status" className="min-h-11 py-2 underline underline-offset-4">
            System status
          </Link>
        </nav>
      </main>
    </div>
  );
}

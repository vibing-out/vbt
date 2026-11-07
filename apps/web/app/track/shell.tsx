import Link from "next/link";
import type { ReactNode } from "react";

/** Voter-mode page frame: a minimal header and one centered column, at most 560px wide. */
export function TrackerShell({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="min-h-dvh bg-surface">
      <header data-print="hide" className="mx-auto flex max-w-[560px] items-center justify-between px-4 py-4">
        <Link href="/track" className="text-label uppercase text-ink focus-visible:outline-2 focus-visible:outline-offset-2">
          <span className="text-accent-text">●</span> Ballot tracker
        </Link>
        <span className="text-small text-ink-muted">Marion County</span>
      </header>
      <main className="mx-auto flex max-w-[560px] flex-col gap-6 px-4 pb-12">{children}</main>
      <footer data-print="hide" className="mx-auto max-w-[560px] px-4 pb-8 text-small text-ink-muted">
        <Link href="/factory" data-testid="factory-link" className="inline-block min-h-11 py-2 underline underline-offset-4">
          How it was built
        </Link>
      </footer>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-03" → "Nov 3". Dates only, never a time of day. */
export function shortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-").map(Number);
  return `${MONTHS[(month ?? 1) - 1]} ${day}`;
}

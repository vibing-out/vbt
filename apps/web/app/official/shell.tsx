import { Button } from "@vbt/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vbt/ui/components/card";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Official } from "../../lib/require-role";

/** The official's own precinct or county view, or null for the state official. */
export function homePath(official: Pick<Official, "scope" | "scopeId">): string | null {
  return official.scope && official.scopeId ? `/official/${official.scope}/${encodeURIComponent(official.scopeId)}` : null;
}

/** Admin-mode page frame for the official tools: a header with the tool links and one wide column. */
export function OfficialShell({
  title,
  description,
  home,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** The official's own precinct or county view, when they have one. */
  home?: string | null;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-h-dvh bg-surface" data-mode="admin">
      <header className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-3 px-4 py-4">
        <Link href="/official" className="text-label uppercase text-ink focus-visible:outline-2 focus-visible:outline-offset-2">
          <span className="text-accent-text">●</span> Official tools
        </Link>
        <OfficialNav home={home} />
      </header>
      <main className="mx-auto flex max-w-[1100px] flex-col gap-6 px-4 pb-12">
        <div className="flex flex-col gap-1">
          <h1 className="text-heading text-ink">{title}</h1>
          {description ? <p className="text-body text-ink-muted">{description}</p> : null}
        </div>
        {children}
      </main>
    </div>
  );
}

export function OfficialNav({ home }: { home?: string | null }): React.JSX.Element {
  const links: Array<[string, string]> = [
    ...(home ? ([[home, "Your view"]] as Array<[string, string]>) : []),
    ["/official/upload", "Upload files"],
    ["/official/challenges", "Challenge queue"],
    ["/official/mismatches", "Mismatch report"],
  ];
  return (
    <nav aria-label="Official tools">
      <ul className="flex flex-wrap gap-2">
        {links.map(([href, label]) => (
          <li key={href}>
            <Button asChild variant="secondary" mode="admin">
              <Link href={href}>{label}</Link>
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A single centered card, for sign-in and refusals. */
export function CenteredCard({
  title,
  description,
  testId,
  children,
}: {
  title: string;
  description?: ReactNode;
  testId?: string;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-h-dvh bg-surface" data-mode="admin">
      <header className="mx-auto flex max-w-[480px] items-center px-4 py-4">
        <Link href="/track" className="text-label uppercase text-ink focus-visible:outline-2 focus-visible:outline-offset-2">
          <span className="text-accent-text">●</span> VBT
        </Link>
      </header>
      <main data-testid={testId} className="mx-auto flex max-w-[480px] flex-col gap-6 px-4 pb-12">
        <Card mode="admin">
          <CardHeader>
            <h1 data-slot="card-title" className="text-heading text-ink">
              {title}
            </h1>
            {description ? <CardDescription mode="admin">{description}</CardDescription> : null}
          </CardHeader>
          {children ? <CardContent>{children}</CardContent> : null}
        </Card>
      </main>
    </div>
  );
}

/** A titled admin card section. */
export function Section({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }): React.JSX.Element {
  return (
    <Card mode="admin">
      <CardHeader>
        <CardTitle mode="admin">{title}</CardTitle>
        {description ? <CardDescription mode="admin">{description}</CardDescription> : null}
      </CardHeader>
      {children ? <CardContent>{children}</CardContent> : null}
    </Card>
  );
}

export type Note = { readonly text: string; readonly ok: boolean } | null;

/** A form's result line: role=status when it worked, role=alert in the discarded color when it did not. */
export function Message({ note }: { note: Note }): React.JSX.Element | null {
  if (!note) return null;
  return note.ok ? (
    <p role="status" className="text-body text-ink">
      {note.text}
    </p>
  ) : (
    <p role="alert" className="text-body text-status-discarded">
      {note.text}
    </p>
  );
}

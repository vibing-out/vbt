// /track: manual code entry. The only field is the tracking code (voter-journey § Design rules).
// The form submits with GET to /track?code=..., which redirects to /track/{CODE}.
import { Button } from "@vbt/ui/components/button";
import { Card, CardDescription, CardTitle } from "@vbt/ui/components/card";
import { CodeText } from "@vbt/ui/components/code-text";
import { Input } from "@vbt/ui/components/input";
import Link from "next/link";
import { redirect } from "next/navigation";
import { normalizeCode, sampleCodes } from "../../lib/demo-election";
import { TrackerShell } from "./shell";

export const metadata = { title: "Track your ballot · VBT" };

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const { code: raw } = await searchParams;
  // A repeated ?code= arrives as an array; use the first.
  const code = Array.isArray(raw) ? raw[0] : raw;
  if (code && code.trim()) redirect(`/track/${encodeURIComponent(normalizeCode(code))}`);
  return (
    <TrackerShell>
      <Card variant="hero" data-testid="track-entry">
        <p className="text-label uppercase text-on-inverse-muted">Marion County General Election · Nov 3, 2026</p>
        <h1 className="text-display">Track your ballot</h1>
        <CardDescription>
          Follow your ballot from cast to certified, with proof at every stage. No account, email or phone number.
        </CardDescription>
      </Card>
      <Card>
        <form action="/track" method="get" className="flex flex-col gap-4">
          <Input
            id="code"
            name="code"
            type="text"
            label="Tracking code"
            hint="Printed on your receipt, or open it by scanning the receipt's QR code."
            placeholder="RIVER-MAPLE-7Q4K-HAWK"
            variant="code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            maxLength={80}
          />
          <Button type="submit" className="w-full">
            Track my ballot
          </Button>
        </form>
      </Card>
      <Card aria-label="Demo codes">
        <CardTitle>Try a demo ballot</CardTitle>
        <ul className="flex flex-col gap-3">
          {sampleCodes().map((s) => (
            <li key={s.code} className="flex flex-col">
              <Link
                href={`/track/${s.code}`}
                className="min-h-11 py-1 text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <CodeText code={s.code} size="inline" />
              </Link>
              <span className="text-small text-ink-muted">{s.note}</span>
            </li>
          ))}
        </ul>
      </Card>
      <p className="text-small text-ink-muted">
        This code shows your ballot&apos;s progress. It does not show how you voted. Demo election: a simplified encryption layer
        that mirrors ElectionGuard.
      </p>
    </TrackerShell>
  );
}

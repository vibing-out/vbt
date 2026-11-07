import { Button } from "@vbt/ui/components/button";
import { Card, CardDescription, CardTitle } from "@vbt/ui/components/card";
import { Receipt } from "@vbt/ui/components/receipt";
import { headers } from "next/headers";
import Link from "next/link";
import { lookup } from "../../../../lib/demo-election";
import { receiptOrigin, receiptQrSvg } from "../../../../lib/receipt-qr";
import { TrackerShell } from "../../shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ballot receipt · VBT" };

export default async function ReceiptPage({ params }: { params: Promise<{ code: string }> }): Promise<React.JSX.Element> {
  const { code } = await params;
  const view = lookup(decodeURIComponent(code));
  if (!view) {
    return (
      <TrackerShell>
        <Card>
          <CardTitle>We couldn&apos;t find that code</CardTitle>
          <CardDescription>Lost receipts can&apos;t be recovered, by design.</CardDescription>
          <Button asChild variant="secondary" className="w-full">
            <Link href="/track">Try another code</Link>
          </Button>
        </Card>
      </TrackerShell>
    );
  }
  const { host, origin } = receiptOrigin(await headers());
  // At least 25mm printed (design system README, Print).
  const qrSvg = await receiptQrSvg(origin, view.trackingCode);
  return (
    <TrackerShell>
      <div className="flex flex-col gap-2" data-print="hide">
        <h1 className="text-title text-ink">Your paper receipt</h1>
        <p className="text-body-lg text-ink-muted">
          The separate slip a voter takes home. Scan its QR code with a phone to open this ballot&apos;s tracker.
        </p>
      </div>
      <Receipt
        form="slip"
        county={view.county.toUpperCase()}
        election="GENERAL ELECTION"
        electionDate="NOV 3, 2026"
        precinct={view.precinct}
        code={view.trackingCode}
        qr={<div className="size-[44mm] [&_svg]:size-full" data-testid="receipt-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />}
        trackUrl={`${host}/track`}
        phone="1-800-555-0100"
      />
      <div className="flex flex-col gap-3" data-print="hide">
        <Button asChild className="w-full">
          <Link href={`/track/${view.trackingCode}`}>Track this ballot</Link>
        </Button>
      </div>
    </TrackerShell>
  );
}

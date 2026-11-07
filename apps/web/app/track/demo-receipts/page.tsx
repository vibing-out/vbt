import { Receipt } from "@vbt/ui/components/receipt";
import { headers } from "next/headers";
import Link from "next/link";
import { lookup, sampleCodes } from "../../../lib/demo-election";
import { receiptOrigin, receiptQrSvg } from "../../../lib/receipt-qr";
import "./demo-receipts.css";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo receipts · VBT" };

/** A printable sheet of the four demo receipts, one letter page, for judges to scan with a phone. */
export default async function DemoReceiptsPage(): Promise<React.JSX.Element> {
  const { host, origin } = receiptOrigin(await headers());
  const slips = await Promise.all(
    sampleCodes().map(async ({ code }) => {
      const view = lookup(code)!;
      return { view, qrSvg: await receiptQrSvg(origin, view.trackingCode) };
    }),
  );
  return (
    <div className="min-h-dvh bg-surface print:bg-transparent">
      <header data-print="hide" className="mx-auto flex max-w-[960px] flex-col gap-3 px-4 py-6">
        <Link href="/track" className="text-label uppercase text-ink focus-visible:outline-2 focus-visible:outline-offset-2">
          <span className="text-accent-text">●</span> Ballot tracker
        </Link>
        <h1 className="text-title text-ink">Demo receipts</h1>
        <p className="text-body-lg text-ink-muted">
          Four sample ballots, one per outcome. Print this page and scan any QR code with a phone, or use &quot;Scan your
          receipt&quot; on the tracker.
        </p>
        <PrintButton />
      </header>
      <main
        data-testid="demo-sheet"
        className="vbt-demo-sheet mx-auto grid max-w-[960px] grid-cols-1 gap-6 px-4 pb-12 md:grid-cols-2"
      >
        {slips.map(({ view, qrSvg }) => (
          <Receipt
            key={view.trackingCode}
            form="slip"
            county={view.county.toUpperCase()}
            election="GENERAL ELECTION"
            electionDate="NOV 3, 2026"
            precinct={view.precinct}
            code={view.trackingCode}
            qr={
              // 38mm keeps four slips on one page and stays above the 25mm print minimum.
              <div className="size-[38mm] [&_svg]:size-full" data-testid="receipt-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />
            }
            trackUrl={`${host}/track`}
            phone="1-800-555-0100"
          />
        ))}
      </main>
    </div>
  );
}

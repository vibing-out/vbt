import { headers } from "next/headers";
import Link from "next/link";
import QRCode from "qrcode";
import { lookup } from "../../../../lib/demo-election";
import { styles } from "../../styles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ballot receipt · VBT" };

const slip = {
  border: "2px dashed #b45309",
  background: "#fef9c3",
  borderRadius: 6,
  padding: "1.25rem",
  maxWidth: 340,
  margin: "1rem auto",
  fontFamily: "ui-monospace, monospace",
  fontSize: "0.85rem",
  lineHeight: 1.5,
} as const;

export default async function ReceiptPage({ params }: { params: Promise<{ code: string }> }): Promise<React.JSX.Element> {
  const { code } = await params;
  const view = lookup(decodeURIComponent(code));
  if (!view) {
    return (
      <main style={styles.main}>
        <h1 style={styles.h1}>We couldn&apos;t find that code</h1>
        <Link href="/track" style={styles.code}>
          ← Try another code
        </Link>
      </main>
    );
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "www.ballottrack.org";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const trackUrl = `${proto}://${host}/track/${view.trackingCode}`;
  const qr = await QRCode.toString(trackUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return (
    <main style={styles.main} data-testid="receipt">
      <div style={slip}>
        <div style={{ fontWeight: 700 }}>{view.county.toUpperCase()} GENERAL ELECTION · NOV 3, 2026</div>
        <div>{view.precinct}</div>
        <div style={{ marginTop: "0.75rem" }}>Your ballot tracking code:</div>
        <div style={{ fontWeight: 700, fontSize: "1rem", wordBreak: "break-all" }} data-testid="receipt-code">
          {view.trackingCode}
        </div>
        <div
          style={{ width: 180, margin: "0.75rem auto", background: "#fff" }}
          aria-label="QR code that opens this ballot's tracking page"
          role="img"
          dangerouslySetInnerHTML={{ __html: qr }}
        />
        <div>Track it: {host}/track</div>
        <div>Or call: 1-800-555-0100 (placeholder)</div>
        <div style={{ marginTop: "0.75rem" }}>This code shows your ballot&apos;s progress. It does not show how you voted.</div>
      </div>
      <p style={{ ...styles.muted, textAlign: "center" }}>
        Scan the QR code with a phone to open this ballot&apos;s tracker.{" "}
        <Link href={`/track/${view.trackingCode}`} style={{ color: "inherit" }}>
          Open it here
        </Link>
      </p>
    </main>
  );
}

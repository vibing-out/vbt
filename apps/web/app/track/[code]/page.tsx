import Link from "next/link";
import { lookup } from "../../../lib/demo-election";
import { styles } from "../styles";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ballot status · VBT" };

export default async function BallotPage({ params }: { params: Promise<{ code: string }> }): Promise<React.JSX.Element> {
  const { code } = await params;
  const view = lookup(decodeURIComponent(code));
  if (!view) {
    return (
      <main style={styles.main} data-testid="track-unknown">
        <p style={styles.eyebrow}>Marion County General Election · Nov 3, 2026</p>
        <h1 style={styles.h1}>We couldn&apos;t find that code</h1>
        <p style={styles.muted}>Check the code on your receipt and try again. Lost receipts can&apos;t be recovered, by design.</p>
        <Link href="/track" style={styles.code}>
          ← Try another code
        </Link>
      </main>
    );
  }
  const statusStyle =
    view.status === "DISCARDED" ? styles.bad : view.status === "CHALLENGED" ? styles.warn : styles.ok;
  return (
    <main style={styles.main} data-testid="track-result">
      <p style={styles.eyebrow}>
        {view.county} General Election · {view.precinct}
      </p>
      <p style={{ ...styles.code, fontSize: "1.2rem", margin: "0.5rem 0" }} data-testid="tracking-code">
        {view.trackingCode}
      </p>
      <h1 style={{ ...styles.h1, ...statusStyle }} data-testid="status">
        {view.statusLabel}
      </h1>
      {view.reason && <p data-testid="reason">Reason: {view.reason}</p>}
      {view.status === "CHALLENGED" && (
        <p style={styles.muted}>
          A cross-check flagged this ballot&apos;s batch. The county election board reviews it; the paper ballot decides.
        </p>
      )}
      <section style={styles.card} aria-label="Integrity check">
        <p style={view.allChecksPass ? styles.ok : styles.bad} data-testid="integrity">
          {view.allChecksPass
            ? "✓ Your encrypted ballot is unchanged and included in every published record."
            : "✗ An integrity check failed. Report this to the county election board."}
        </p>
        <p style={styles.mono}>Encrypted ballot fingerprint (SHA-256): {view.ciphertextHash}</p>
      </section>
      <ol style={{ ...styles.list, borderLeft: "3px solid #e3e3ea", paddingLeft: "1rem" }} data-testid="timeline">
        {view.timeline.map((t) => (
          <li key={t.status} style={{ marginBottom: "1.1rem" }}>
            <strong>{t.label}</strong> <span style={styles.muted}>· {t.date}</span>
            {t.record && (
              <div style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}>
                <span style={t.record.included ? styles.ok : styles.bad}>
                  {t.record.included ? "✓ Included" : "✗ Not found"}
                </span>{" "}
                in the {t.record.scope} public record ({t.record.ballotCount} ballots)
                <div style={styles.mono}>Merkle root: {t.record.merkleRoot}</div>
              </div>
            )}
          </li>
        ))}
      </ol>
      <p style={styles.footnote}>
        This page shows your ballot&apos;s progress, never how you voted or when. Sharing it proves nothing about your vote.{" "}
        <Link href="/track" style={{ color: "inherit" }}>
          Track another ballot
        </Link>
      </p>
    </main>
  );
}

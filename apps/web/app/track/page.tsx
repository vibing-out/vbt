import Link from "next/link";
import { redirect } from "next/navigation";
import { normalizeCode, sampleCodes } from "../../lib/demo-election";
import { styles } from "./styles";

export const metadata = { title: "Track your ballot · VBT" };

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}): Promise<React.JSX.Element> {
  const { code } = await searchParams;
  if (code && code.trim()) redirect(`/track/${encodeURIComponent(normalizeCode(code))}`);
  return (
    <main style={styles.main} data-testid="track-entry">
      <p style={styles.eyebrow}>Marion County General Election · Nov 3, 2026</p>
      <h1 style={styles.h1}>Track your ballot</h1>
      <p style={styles.muted}>
        Enter the tracking code printed on your receipt, or scan its QR code. No account, email or phone number needed.
      </p>
      <form action="/track" method="get" style={styles.form}>
        <label htmlFor="code" style={styles.label}>
          Tracking code
        </label>
        <input
          id="code"
          name="code"
          placeholder="RIVER-MAPLE-7Q4K-HAWK"
          autoComplete="off"
          autoCapitalize="characters"
          required
          style={styles.input}
        />
        <button type="submit" style={styles.button}>
          Track
        </button>
      </form>
      <section style={styles.card} aria-label="Sample codes">
        <h2 style={styles.h2}>Demo codes</h2>
        <ul style={styles.list}>
          {sampleCodes().map((s) => (
            <li key={s.code} style={{ marginBottom: "0.5rem" }}>
              <Link href={`/track/${s.code}`} style={styles.code}>
                {s.code}
              </Link>{" "}
              <span style={styles.muted}>— {s.note}</span>
            </li>
          ))}
        </ul>
      </section>
      <p style={styles.footnote}>
        This code shows your ballot&apos;s progress. It does not show how you voted. Demo data: a simplified encryption layer
        that mirrors ElectionGuard.
      </p>
    </main>
  );
}

// /track: manual code entry. The only field is the tracking code (voter-journey § Design rules).
// The form submits with GET to /track?code=..., which redirects to /track/{CODE}.
import Link from "next/link";
import { redirect } from "next/navigation";
import { tokens } from "@vbt/ui";
import { normaliseCode } from "../../lib/track/code";
import { RECEIPT_FOOTER } from "../../lib/track/copy";

export const metadata = { title: "Track a ballot · VBT" };

export default async function TrackEntryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code: raw } = await searchParams;
  const first = Array.isArray(raw) ? raw[0] : raw;
  const code = first === undefined ? "" : normaliseCode(first);
  if (code) redirect(`/track/${encodeURIComponent(code)}`);

  return (
    <main
      data-testid="track-entry"
      style={{
        fontFamily: tokens.font.body,
        color: tokens.color.text,
        padding: tokens.space.md,
        maxWidth: "36rem",
        margin: "0 auto",
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ color: tokens.color.accent, fontSize: "1.5rem" }}>Track a ballot</h1>
      <p>Scan the QR code on your receipt with your camera, or type the tracking code printed on it.</p>
      <form method="get" action="/track" style={{ display: "grid", gap: tokens.space.sm }}>
        <label htmlFor="code" style={{ fontWeight: 600 }}>
          Tracking code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          required
          maxLength={80}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="RIVER-MAPLE-7Q4K-HAWK"
          style={{ fontSize: "1.1rem", padding: tokens.space.sm }}
        />
        <button type="submit" style={{ fontSize: "1.1rem", padding: tokens.space.sm }}>
          Track ballot
        </button>
      </form>
      <p style={{ color: tokens.color.muted }}>
        Anyone with a code can look it up. Lost receipts can&apos;t be recovered, by design.
      </p>
      <p>
        <Link href="/" style={{ color: tokens.color.accent }}>
          Home
        </Link>
      </p>
      <footer style={{ color: tokens.color.muted }}>{RECEIPT_FOOTER}</footer>
    </main>
  );
}

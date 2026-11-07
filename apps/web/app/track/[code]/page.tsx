// /track/{code}: the page a receipt's QR code opens. A server shell that passes only the code; the client
// fetches GET /api/track/{code} and polls it, so first paint and live updates share one code path.
import { redirect } from "next/navigation";
import { isWellFormedCode, normaliseCode } from "../../../lib/track/code";
import { Tracker } from "../tracker";

export const metadata = { title: "Track a ballot · VBT" };

export default async function TrackCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normaliseCode(raw);
  // Canonical URL for a typed or lower-case code. Malformed codes stay put and get the generic message.
  if (isWellFormedCode(code) && code !== raw) redirect(`/track/${code}`);
  return (
    <>
      <noscript>
        <p style={{ padding: "1rem" }}>The ballot tracker needs JavaScript turned on to look up a code.</p>
      </noscript>
      <Tracker code={code} />
    </>
  );
}

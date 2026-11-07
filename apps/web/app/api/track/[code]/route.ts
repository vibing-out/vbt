// GET /api/track/{code}: the public tracker (locked-interfaces § API boundaries). No auth; rate-limited.
// Returns status, a dated timeline, the ciphertext hash and a check per published stage.
import { handleTrackRequest } from "../../../../lib/track/handler";
import { lookupWithDemoFallback } from "../../../../lib/track/demo-fallback";
import { firewallRateLimiter } from "../../../../lib/track/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await context.params;
  return handleTrackRequest(request, code, {
    isRateLimited: firewallRateLimiter,
    lookup: (normalised) => lookupWithDemoFallback(normalised),
  });
}
